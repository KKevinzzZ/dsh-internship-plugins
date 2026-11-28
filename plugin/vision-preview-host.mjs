import { EntryGroup } from '@deepseek-ai/cordis-plugin-loader'
import { z } from 'zod'
import { VISION_CONTEXT_SOURCE } from './vision-preprocess.mjs'

export const name = 'internship-vision-preview'
export const inject = ['loader']

const visionHistory = {
  key: 'internship-vision-history',
  stateVersion: 1,
  stateSchema: z.boolean(),
  init: () => false,
  apply: (seen, event) => seen || (event.type === 'user/message'
    && (event.data.source.kind === VISION_CONTEXT_SOURCE || Boolean(event.data.source.internshipVisionPreview))),
}

export async function apply(ctx) {
  // Keep the exclusion after B1 is toggled off and across compaction, fork, and resume.
  ctx.inject(['sessions', 'sessionProjections', 'sessionLogDeepSeek'], async child => {
    const history = await child.sessionProjections.register(visionHistory)
    child.sessionLogDeepSeek.registerExclusion(({ sessionId }) => {
      const session = child.sessions.get(sessionId)
      return session !== undefined && history.stateOf(session)
    })
  })

  // DSH discovers Web clients from package roots and file entries, not package subpaths.
  const group = new EntryGroup(ctx, ctx.fiber.entry.parent.tree)
  ctx.effect(() => () => group.stop())
  await group.update([{
    id: 'internship-vision-preview-client',
    name: new URL('./vision-preview-client-host.mjs', import.meta.url).href,
  }])
}
