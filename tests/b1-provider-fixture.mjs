/** Local integration fixture for the two provider HTTP contracts. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { setTimeout } from 'node:timers/promises'

const answer = 'K7M-2048'
const description = `仓库标签上写着 LOT / ${answer}。`
const readCallId = 'call_b1_fixture_read_image'
const processedDigests = new Set()
const pendingQuestions = new Set()

globalThis.fetch = async (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input)
  if (url.hostname === 'open.bigmodel.cn' && url.pathname === '/api/paas/v4/chat/completions') {
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'glm-5.3-flash')
    assert.deepEqual(body.thinking, { type: 'enabled' })
    assert.equal(body.reasoning_effort, 'high')
    const dataUrl = body.messages[0].content[0].image_url.url
    assert.ok(dataUrl.startsWith('data:image/png;base64,'))
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
    assert.ok(bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    processedDigests.add(createHash('sha256').update(bytes).digest('hex'))
    pendingQuestions.add(body.messages[0].content[1].text.split('\n\nUser question:\n')[1])
    return Response.json({
      choices: [{ message: { content: description }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 14, total_tokens: 134 },
    })
  }
  if (url.hostname === 'api.deepseek.com' && url.pathname.endsWith('/models')) {
    return Response.json({ object: 'list', data: [{
      id: 'deepseek-flash', name: 'DeepSeek-V4.1-Flash', context_window: 1_048_576, max_output_tokens: 393_216,
      input_modalities: ['text', 'image'], output_modalities: ['text'],
      api_capabilities: { anthropic_messages: { system_prompt_update: 'in-history' } },
    }] })
  }
  if (url.hostname === 'api.deepseek.com' && url.pathname.endsWith('/messages')) {
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'deepseek-flash')
    const content = body.messages.filter(message => message.role === 'user').flatMap(message => message.content)
    const imageBlocks = content.filter(block => block.type === 'image').length
    const descriptionBlocks = content.filter(block => block.type === 'text' && block.text.startsWith('[B1 image '))
    const hasText = text => content.some(block => block.type === 'text' && block.text === text)
    const readResult = content.find(block => block.type === 'tool_result' && block.tool_use_id === readCallId)
    const workspaceRead = hasText('请读取工作区里的 b1-workspace.png。')
    if (readResult) {
      assert.notEqual(readResult.is_error, true)
      assert.ok(readResult.content.some(block => block.type === 'image'))
    }
    const readFilePath = workspaceRead && !readResult ? 'b1-workspace.png' : undefined
    const hasReadImage = body.tools?.some(tool => tool.name === 'read_image') === true
    if (pendingQuestions.size > 0) {
      assert.ok(descriptionBlocks.length > 0)
      for (const question of pendingQuestions) {
        if (question && !hasText(question)) {
          console.error('[b1-fixture] Main request lost the original question block.')
          assert.fail('B1 must preserve the original question')
        }
      }
      pendingQuestions.clear()
    }
    if (descriptionBlocks.length > 0) {
      assert.equal(imageBlocks, 0)
      assert.ok(descriptionBlocks.every(block => block.text.endsWith(description)))
      assert.equal(body.dsh_session_log, undefined, 'B1 sessions use local session logs')
      const wire = JSON.stringify({
        ...body, messages: body.messages.map(message => ({ ...message, content: message.content.filter(block => block !== readResult) })),
      })
      if (/internshipVisionPreview|Normalized copy|sha256:[a-f0-9]{64}|attachments[\\/]+v1[\\/]+objects/i.test(wire)) {
        console.error('[b1-fixture] Unexpected metadata or attachment handle in the main request.')
        assert.fail('B1 must omit preview metadata and attachment handles')
      }
      for (const digest of processedDigests) {
        assert.ok(!wire.includes(digest), 'B1 attachment digest was serialized')
      }
    }
    if (imageBlocks > 0) assert.ok(body.dsh_session_log, 'native sessions keep the profile session-log configuration')
    if (readFilePath !== undefined) assert.equal(hasReadImage, true)
    console.log(`[b1-fixture] ${JSON.stringify({ imageBlocks, descriptionBlocks: descriptionBlocks.length, workspaceImageRead: Boolean(readResult), hasReadImage })}`)
    if (descriptionBlocks.length === 0 && hasText('等待 B1 测试追加图片。')) await setTimeout(1200, undefined, { signal: options.signal })
    const block = readFilePath === undefined
      ? { type: 'text', text: '' }
      : { type: 'tool_use', id: readCallId, name: 'read_image', input: { file_path: readFilePath } }
    const events = [
      { type: 'message_start', message: { id: 'message_fixture', model: body.model, usage: { input_tokens: 101, output_tokens: 0 } } },
      { type: 'content_block_start', index: 0, content_block: block },
      ...readFilePath === undefined ? [{ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: answer } }] : [],
      { type: 'content_block_stop', index: 0 },
      { type: 'message_delta', delta: { stop_reason: readFilePath === undefined ? 'end_turn' : 'tool_use' }, usage: { output_tokens: 7 } },
      { type: 'message_stop' },
    ]
    const stream = events.map(event => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join('')
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  throw new Error(`Unexpected HTTP request in B1 fixture: ${url.hostname}${url.pathname}`)
}
