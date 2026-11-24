import {lookup} from 'node:dns';
import {isIP,type LookupFunction} from 'node:net';
import ipaddr from 'ipaddr.js';
import {Agent} from 'undici';

export function publicAddress(address:string) {
  if (!isIP(address)) return false;
  const parsed = ipaddr.parse(address);
  return parsed.range() === 'unicast' &&
    (parsed.kind() === 'ipv4' || parsed.toByteArray()[0] >> 5 === 1);
}

const publicLookup:LookupFunction = (hostname,options,callback) => {
  lookup(hostname,{all:true},(error,records) => {
    if (error) return callback(error,'',0);
    if (!records.length || records.some(record=>!publicAddress(record.address))) {
      return callback(Error('Upstream DNS did not resolve exclusively to public addresses'),'',0);
    }
    const family = options.family==='IPv4'?4:options.family==='IPv6'?6:options.family;
    const matching = family ? records.filter(record=>record.family===family) : records;
    const first = matching[0];
    if (!first) return callback(Error('No matching upstream address'),'',0);
    if (options.all) return callback(null,matching);
    return callback(null,first.address,first.family);
  });
};

export function validateEndpoint(raw:string,trusted:boolean) {
  const url = new URL(raw);
  const localHttp = url.protocol==='http:' && ['127.0.0.1','localhost'].includes(url.hostname);
  if (url.username || url.password || url.hash || (!trusted && url.search) ||
    (url.protocol!=='https:' && !(trusted && localHttp))) {
    throw Error('Invalid upstream endpoint');
  }
  const address = url.hostname.replace(/^\[|\]$/g,'');
  if (!trusted && (url.hostname==='localhost' || url.hostname.endsWith('.localhost') ||
    (isIP(address) && !publicAddress(address)))) throw Error('Private endpoint denied');
  return url;
}

export function upstreamNetwork(url:URL,trusted:boolean) {
  const dispatcher = new Agent({connect:{timeout:5000,lookup:trusted?undefined:publicLookup}});
  return {
    fetch:(input:string|URL,init?:RequestInit) => {
      if (new URL(input).origin!==url.origin) throw Error('Upstream origin changed');
      const options:RequestInit & {dispatcher:Agent} = {...init,dispatcher,redirect:'error'};
      options.signal = AbortSignal.any([AbortSignal.timeout(15000),...(options.signal?[options.signal]:[])]);
      return fetch(input,options);
    },
    close:() => dispatcher.destroy(),
  };
}
