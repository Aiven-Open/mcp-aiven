import { BlockList, isIP } from 'node:net';

const CLOUDFLARE_IPV4_CIDRS: readonly string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
];

const CLOUDFLARE_IPV6_CIDRS: readonly string[] = [
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
];

function addCidr(list: BlockList, cidr: string, family: 'ipv4' | 'ipv6'): void {
  const slash = cidr.indexOf('/');
  const addr = cidr.slice(0, slash);
  const bits = parseInt(cidr.slice(slash + 1), 10);
  list.addSubnet(addr, bits, family);
}

const cloudflareBlockList = ((): BlockList => {
  const list = new BlockList();
  for (const cidr of CLOUDFLARE_IPV4_CIDRS) addCidr(list, cidr, 'ipv4');
  for (const cidr of CLOUDFLARE_IPV6_CIDRS) addCidr(list, cidr, 'ipv6');
  return list;
})();

const IPV4_MAPPED_IPV6_PREFIX = '::ffff:';

/** Strip `::ffff:` prefix from IPv4-mapped IPv6 (Node dual-stack sockets emit this form). */
export function normalizePeerIp(ip: string | undefined): string | undefined {
  if (ip === undefined) return undefined;
  if (ip.toLowerCase().startsWith(IPV4_MAPPED_IPV6_PREFIX)) {
    const v4 = ip.slice(IPV4_MAPPED_IPV6_PREFIX.length);
    if (isIP(v4) === 4) return v4;
  }
  return ip;
}

/** True iff `ip` is a valid IP inside Cloudflare's published edge ranges. */
export function isCloudflareAddress(ip: string | undefined): boolean {
  if (ip === undefined) return false;
  const family = isIP(ip);
  if (family === 0) return false;
  return cloudflareBlockList.check(ip, family === 4 ? 'ipv4' : 'ipv6');
}
