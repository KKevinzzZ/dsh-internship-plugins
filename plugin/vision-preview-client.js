window.__ModuleLoader__.load({
  id: 'dsh-internship-plugin',
  factory: () => ({
    inject: ['uiConversation'],
    apply(ctx) {
      const events = ctx.uiConversation.events
      const nativeMessage = events.entries().find(definition => definition.kind === 'input-message' && definition.target === 'chat')
      if (!nativeMessage) throw new Error('B1 preview requires the DSH Chat input-message definition.')

      events.register({
        ...nativeMessage,
        kind: 'internship-vision-preview-user',
        match(event) {
          if (event.type !== 'user/message' || event.data.source.kind !== 'user') return null
          const previews = event.data.source.internshipVisionPreview
          if (!Array.isArray(previews) || previews.length === 0) return null
          const match = nativeMessage.match(event)
          return match === null ? null : { ...match, exclusive: true }
        },
        start(context, match, reader) {
          const { event } = match
          const content = [...event.data.content]
          for (const { index, attachment } of event.data.source.internshipVisionPreview) {
            content.splice(index, 0, { type: 'image', attachment })
          }
          const renderEvent = { ...event, data: { ...event.data, content } }
          return nativeMessage.start(context, { ...match, event: renderEvent }, reader)
        },
      })
    },
  }),
})
