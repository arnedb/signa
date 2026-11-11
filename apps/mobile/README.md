# Mobile app (milestone 9)

Placeholder. The Expo (React Native) app comes later, with Expo Router.

What is already in place for it:

- **Auth**: `POST /api/v1/auth/login` with `"client": "mobile"` returns a session `token`
  instead of setting a cookie. Send it as `Authorization: Bearer <token>`.
- **API client**: `@vgt/api-client` works in React Native. Pass `baseUrl` and `getToken`:

  ```ts
  import { createApi } from "@vgt/api-client";
  const api = createApi({ baseUrl: "https://vgt.arnedb.be", getToken: () => SecureStore.getItemAsync("token") });
  ```

- **Practice logic**: `@vgt/core` (deck building, the session reducer, keyboard map and all
  Dutch UI text) has no DOM or React dependencies.
- **Video**: every clip is H.264 MP4 with `+faststart`, served with range requests. Clip URLs
  carry `?v=<updated_at>`, and `clips.updated_at` tells the app when a cached clip is stale.
  Video requests need the same `Authorization` header (expo-video supports request headers).
