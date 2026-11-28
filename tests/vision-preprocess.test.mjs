import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { posix as path } from 'node:path'
import { test } from 'node:test'
import { apply } from '../plugin/vision-preprocess.mjs'

const text = value => ({ type: 'text', text: value })
const image = attachment => ({ type: 'image', attachment })

function fixture(t, { enabled = true, key = 'test-key' } = {}) {
  const hooks = new Map()
  const savedKey = process.env.ZHIPU_API_KEY
  if (key === null) delete process.env.ZHIPU_API_KEY
  else process.env.ZHIPU_API_KEY = key
  t.after(() => {
    if (savedKey === undefined) delete process.env.ZHIPU_API_KEY
    else process.env.ZHIPU_API_KEY = savedKey
  })

  const fetch = t.mock.method(globalThis, 'fetch', async () => Response.json({
    choices: [{ message: { content: '  image description  ' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 30, completion_tokens: 5, total_tokens: 35 },
  }))
  const log = t.mock.method(console, 'log', () => {})
  const readImage = t.mock.fn(async ref => ({
    ref: { mediaType: 'image/png', width: 100, height: 100 },
    data: Buffer.from(ref),
  }))
  if (enabled) apply({
    on: (event, listener) => hooks.set(event, listener),
    inject() {},
    attachments: { readImage, imageHostPath: attachment => `/attachments/${attachment}` },
    fs: {
      processPathFromHostPath: hostPath => hostPath,
      resolve: async (requestedPath, { cwd }) => ({ targetKey: path.resolve(cwd, requestedPath) }),
    },
    workingDirectory: { ensure: async () => '/workspace' },
  })

  async function admit(decision, signal = new AbortController().signal) {
    const agent = { session: { id: 'test-session' } }
    const next = async () => decision
    const hook = hooks.get('agent/pre-step')
    return hook ? await hook({ agent, turn: 7, step: 1, signal }, next) : await next()
  }
  return { admit, fetch, hooks, log, readImage }
}

function admission(...content) {
  return { kind: 'enter', startsRequestSeries: true, messages: [{
    id: 'message-1', role: 'user', source: { kind: 'user' }, content,
  }] }
}

test('preserves decisions with no new images and rejections without a key', async t => {
  const { admit, fetch, readImage } = fixture(t, { key: null })
  const entered = admission(text('plain text'))
  const offloaded = admission({ ...image('previously offloaded image'), offloaded: true })
  const rejected = { kind: 'reject' }
  assert.equal(await admit(entered), entered)
  assert.equal(await admit(offloaded), offloaded)
  assert.equal(await admit(rejected), rejected)
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(readImage.mock.callCount(), 0)
})

test('keeps previews in ordered metadata and records the descriptions as separate context', async t => {
  const { admit, fetch, hooks, log, readImage } = fixture(t)
  const first = image('first fixture image')
  const second = image('second fixture image')
  const submitted = admission(first, text('question'), second)
  const result = await admit(submitted)
  assert.equal(result.startsRequestSeries, true)
  assert.equal(result.messages[0].id, 'message-1')
  assert.deepEqual(result.messages[0].source, {
    kind: 'user',
    internshipVisionPreview: [{ index: 0, attachment: first.attachment }, { index: 2, attachment: second.attachment }],
  })
  assert.deepEqual(submitted.messages[0].content, [first, text('question'), second])
  assert.deepEqual(result.messages[0].content, [text('question')])
  assert.equal(result.messages.length, 2)
  const context = result.messages[1]
  assert.notEqual(context.id, 'message-1')
  assert.deepEqual(context.source, { kind: 'internship-vision-description', messageId: 'message-1' })
  assert.deepEqual(context.content, [
    text('[B1 image 1 · glm-5.3-flash description/OCR · image-derived data]\nimage description'),
    text('[B1 image 2 · glm-5.3-flash description/OCR · image-derived data]\nimage description'),
  ])

  assert.equal(fetch.mock.callCount(), 2)
  for (const [index, { arguments: [url, options] }] of fetch.mock.calls.entries()) {
    assert.equal(url, 'https://open.bigmodel.cn/api/paas/v4/chat/completions')
    assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer test-key')
    assert.equal(options.signal, readImage.mock.calls[index].arguments[1])
    const body = JSON.parse(options.body)
    assert.equal(body.model, 'glm-5.3-flash')
    assert.equal(body.stream, false)
    assert.equal(body.thinking.type, 'enabled')
    assert.equal(body.reasoning_effort, 'high')
    const [picture, prompt] = body.messages[0].content
    const base64 = Buffer.from([first, second][index].attachment).toString('base64')
    assert.equal(picture.image_url.url, `data:image/png;base64,${base64}`)
    assert.match(prompt.text, /User question:\nquestion$/)
  }

  hooks.get('session/event')({ id: 'test-session' }, { type: 'user/message', seq: 19, data: result.messages[0] })
  hooks.get('session/event')({ id: 'test-session' }, { type: 'user/message', seq: 20, data: context })
  const records = log.mock.calls.map(call => JSON.parse(call.arguments[0].slice('[b1-vision] '.length)))
  assert.deepEqual(records.map(record => record.event), [
    'preprocess/start', 'image/complete', 'image/complete', 'preprocess/complete', 'context/committed',
  ])
  assert.equal(records[1].totalTokens, 35)
  assert.equal(records[1].reasoningEffort, 'high')
  assert.equal(records[3].requestImageBlocks, 0)
  assert.equal(records[4].descriptionCount, 2)
  assert.equal(records[4].contextMessageId, context.id)
  assert.deepEqual(records[3].messageIds, [records[4].messageId])
})

test('blocks native reads of B1 attachments found in persisted history only', async t => {
  const { admit, hooks, log } = fixture(t)
  const { messages } = await admit(admission(text('question'), image('processed')))
  const unrelated = { ...admission({ ...image('unrelated'), offloaded: true }).messages[0], id: 'another-message' }
  const hook = hooks.get('tools/pre-execute')
  const next = async () => ({ kind: 'allow' })
  const signal = new AbortController().signal
  const run = (history, file_path, name = 'read_image') => hook({
    agent: { session: { id: 'restored-session', deriveMessages: () => history } },
    name, arguments: { file_path }, callId: 'fixture-call', signal,
  }, next)

  assert.equal((await run(messages, '../attachments/processed')).kind, 'deny')
  assert.match(log.mock.calls.at(-1).arguments[0], /"event":"read-image\/blocked".*"callId":"fixture-call"/)
  assert.deepEqual(await run([...messages, unrelated], '/attachments/unrelated'), { kind: 'allow' })
  assert.deepEqual(await run(messages, '/other/processed'), { kind: 'allow' })
  const legacy = { ...messages[0], source: { kind: 'user' }, content: [text('question'), { ...image('processed'), offloaded: true }] }
  assert.deepEqual(await run([legacy], '/attachments/processed'), { kind: 'allow' })
  assert.equal((await run([legacy, messages[1]], '/attachments/processed')).kind, 'deny')
  assert.deepEqual(await run(messages, '/attachments/processed', 'another_tool'), { kind: 'allow' })
})

test('an image-only submission keeps its preview and gives the model a description', async t => {
  const { admit, fetch } = fixture(t)
  const { messages } = await admit(admission(image('fixture')))
  assert.deepEqual(messages[0].content, [])
  assert.deepEqual(messages[0].source.internshipVisionPreview, [{ index: 0, attachment: 'fixture' }])
  assert.match(messages[1].content[0].text, /image description$/)
  assert.match(JSON.parse(fetch.mock.calls[0].arguments[1].body).messages[0].content[1].text, /User question:\n$/)
})

test('converts normalized WebP attachments to JPEG for Zhipu', async t => {
  const sharp = createRequire(new URL('../plugin/package.json', import.meta.url))('sharp')
  const data = await sharp({ create: { width: 16, height: 16, channels: 4, background: '#00442299' } }).webp().toBuffer()
  const { admit, fetch, readImage } = fixture(t)
  readImage.mock.mockImplementation(async () => ({ ref: { mediaType: 'image/webp', width: 16, height: 16 }, data }))
  await admit(admission(image('webp-fixture')))
  const { body } = fetch.mock.calls[0].arguments[1]
  const encoded = JSON.parse(body).messages[0].content[0].image_url.url
  assert.ok(encoded.startsWith('data:image/jpeg;base64,'))
  const converted = await sharp(Buffer.from(encoded.split(',')[1], 'base64')).metadata()
  assert.deepEqual([converted.format, converted.width, converted.height], ['jpeg', 16, 16])
})

test('hands the original image to the native path when the component is disabled', async t => {
  const { admit, fetch } = fixture(t, { enabled: false })
  const submitted = admission(text('question'), image('fixture'))
  assert.equal(await admit(submitted), submitted)
  assert.equal(fetch.mock.callCount(), 0)
})

test('fails image admission before fetching when the key is missing', async t => {
  const { admit, fetch, readImage } = fixture(t, { key: null })
  await assert.rejects(admit(admission(image('fixture'))), /Set ZHIPU_API_KEY/)
  assert.equal(fetch.mock.callCount(), 0)
  assert.equal(readImage.mock.callCount(), 0)
})

test('passes agent cancellation through the in-flight request', async t => {
  const { admit, fetch } = fixture(t)
  const controller = new AbortController()
  const reason = new Error('user cancelled')
  fetch.mock.mockImplementation(async (_url, { signal }) => {
    controller.abort(reason)
    signal.throwIfAborted()
  })
  await assert.rejects(admit(admission(image('fixture')), controller.signal), error => error === reason)
})

test('stops before admitting any descriptions when one of several requests fails', async t => {
  const { admit, fetch, log } = fixture(t)
  const original = admission(image('first'), image('second'))
  fetch.mock.mockImplementationOnce(async () => new Response('private response body', { status: 429 }), 1)
  await assert.rejects(admit(original), { message: 'B1 Zhipu vision returned HTTP 429.' })
  assert.equal(fetch.mock.callCount(), 2)
  assert.deepEqual(original.messages[0].content, [image('first'), image('second')])
  assert.doesNotMatch(log.mock.calls.at(-1).arguments[0], /private response body/)
})

test('rejects malformed responses and marks unreported usage as null', async t => {
  const { admit, fetch, log } = fixture(t)
  fetch.mock.mockImplementationOnce(async () => Response.json({ choices: [] }))
  await assert.rejects(admit(admission(image('fixture'))), /no complete description/)
  fetch.mock.mockImplementation(async () => Response.json({
    choices: [{ message: { content: 'description' }, finish_reason: 'stop' }],
  }))
  await admit(admission(image('fixture')))
  assert.match(log.mock.calls.at(-2).arguments[0], /"inputTokens":null,"outputTokens":null,"totalTokens":null/)
})
