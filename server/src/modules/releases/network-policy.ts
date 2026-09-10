import { lookup, resolve4, resolve6 } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent } from 'undici';

export function publicAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && (b === 168 || b === 0 || b === 2) || a === 100 && b >= 64 && b <= 127 || a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) || a === 203 && b === 0 && c === 113);
  }
  if (isIP(address) !== 6 || !/^[23][0-9a-f]{3}:/i.test(address)) return false;
  const parts = address.toLowerCase().split(':'); const first = parseInt(parts[0]!,16); const second = parseInt(parts[1] || '0',16);
  return first !== 0x2002 && first !== 0x3fff && !(first === 0x2001 && (second < 0x200 || second === 0xdb8));
}
/** Validate the addresses actually handed to the socket, not a separate preflight lookup. */
export const officialDispatcher = new Agent({ connect: { lookup(hostname, options, callback) {
  void lookup(hostname, { all: true, verbatim: true }).then(async addresses => {
    if (addresses.some(row => !publicAddress(row.address))) {
      const answers = await Promise.allSettled([resolve4(hostname), resolve6(hostname)]);
      addresses = answers.flatMap((answer,index) => answer.status === 'fulfilled' ? answer.value.map(address => ({ address, family: index === 0 ? 4 : 6 })) : []);
    }
    if (!addresses.length || addresses.some(row => !publicAddress(row.address))) { callback(new Error('Official source resolved to a non-public address'), '', 4); return; }
    if (options.all) callback(null, addresses);
    else callback(null, addresses[0]!.address, addresses[0]!.family);
  }).catch(error => callback(error, '', 4));
} } });
