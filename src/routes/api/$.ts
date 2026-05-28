import { createFileRoute } from '@tanstack/react-router'
import { handleApi } from '~/server/api'

export const Route = createFileRoute('/api/$')({
  server: {
    handlers: {
      GET: ({ request, params }) => handleApi(request, params._splat ?? ''),
      POST: ({ request, params }) => handleApi(request, params._splat ?? ''),
      PUT: ({ request, params }) => handleApi(request, params._splat ?? ''),
    },
  },
})
