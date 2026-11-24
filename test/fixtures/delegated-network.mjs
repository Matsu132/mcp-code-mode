const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input,init) => {
  const url = new URL(input);
  if (url.href===process.env.FIXTURE_MCP) return nativeFetch(input,init);
  if (url.origin==='https://identity.fixture.test' && url.pathname==='/jwks') {
    return Response.json({keys:[JSON.parse(process.env.FIXTURE_JWK)]});
  }
  if (url.origin==='https://resource.fixture.test') {
    if (url.pathname==='/.well-known/oauth-protected-resource/mcp') {
      return Response.json({resource:url.origin+'/mcp',authorization_servers:['https://authorization.fixture.test']});
    }
    if (url.pathname==='/mcp') return nativeFetch(process.env.FIXTURE_MCP,init);
  }
  if (url.origin==='https://authorization.fixture.test') {
    if (url.pathname==='/.well-known/oauth-authorization-server') return Response.json({
      issuer:url.origin,authorization_endpoint:url.origin+'/authorize',token_endpoint:url.origin+'/token',
      response_types_supported:['code'],code_challenge_methods_supported:['S256'],
      token_endpoint_auth_methods_supported:['none'],
    });
    if (url.pathname==='/token') {
      const form = new URLSearchParams(init.body);
      if (form.get('client_id')==='gateway-fixture' && form.get('code_verifier')?.length===43) {
        return Response.json({
          access_token:'upstream-'+form.get('code'),
          token_type:'Bearer',expires_in:3600,
        });
      }
    }
  }
  throw Error('Unexpected fixture request');
};
