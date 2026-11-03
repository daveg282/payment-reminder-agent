import 'cookie-session';

declare module 'cookie-session' {
  interface CookieSessionObject {
    authed?: boolean;
    googleState?: string;
  }
}
