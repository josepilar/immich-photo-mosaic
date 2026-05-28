import { defineNitroConfig } from 'nitro/config'

const appShellHeaders = {
  'cache-control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
  expires: '0',
  pragma: 'no-cache',
}

export default defineNitroConfig({
  routeRules: {
    '/': { headers: appShellHeaders },
    '/index.html': { headers: appShellHeaders },
  },
})
