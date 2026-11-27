export const name = 'internship-turn-trace'

function log(event, position, details = {}) {
  console.log(`[turn-trace] ${JSON.stringify({ event, ...position, ...details })}`)
}

export function apply(ctx) {
  const turns = new Map()

  ctx.on('session/event', (session, event) => {
    const sessionId = session.id
    const { turn, step } = event.data
    const position = { sessionId, turn, step, seq: event.seq }

    if (event.type === 'turn/start') {
      turns.set(sessionId, { turn, calls: new Map() })
      log(event.type, position)
      return
    }

    const active = turns.get(sessionId)
    if (!active || active.turn !== turn) return

    switch (event.type) {
      case 'step/start':
        log(event.type, position)
        break
      case 'tool/call': {
        const { callId, name: tool } = event.data
        active.calls.set(callId, { step, tool })
        log(event.type, position, { callId, tool })
        break
      }
      case 'tool/result': {
        const { toolCallId: callId, isError } = event.data.message
        const tool = active.calls.get(callId)?.tool
        active.calls.delete(callId)
        log(event.type, position, { callId, tool, isError })
        break
      }
      case 'turn/end':
        turns.delete(sessionId)
        log(event.type, position, { reason: event.data.reason.kind })
        break
    }
  })

  ctx.on('internal/dispatch', (_mode, event, args) => {
    if (event === 'agent/pre-step') {
      const { agent, turn, step } = args[0]
      const sessionId = agent.session.id
      if (turns.get(sessionId)?.turn === turn) log(event, { sessionId, turn, step })
    }

    if (event === 'tools/execute') {
      const { agent, callId, name: tool } = args[0]
      const sessionId = agent?.session.id
      const active = turns.get(sessionId)
      const call = active?.calls.get(callId)
      if (call) log(event, { sessionId, turn: active.turn, step: call.step }, { callId, tool })
    }
  })

  ctx.on('session/disposed', session => turns.delete(session.id))
}
