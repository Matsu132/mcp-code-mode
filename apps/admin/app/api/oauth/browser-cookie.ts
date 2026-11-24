export function browserCookieName(state:string) {
  return /^[A-Za-z0-9_-]{43}$/.test(state)?'mcp_oauth_browser_'+state:undefined;
}
