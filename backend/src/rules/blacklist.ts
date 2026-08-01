/**
 * Known-malicious IP ranges (credential stuffing proxies etc.).
 * Synthetic demo data uses 185.220.101.x / 185.220.102.x.
 */

export const BLACKLISTED_CIDRS: string[] = [
  '185.220.101.0/24',
  '185.220.102.0/24',
];

function ipToPrefix(ip: string, prefix: number): string {
  const octets = ip.split('.');
  return octets.slice(0, Math.ceil(prefix / 8)).join('.');
}

export function isBlacklistedIp(ip: string): boolean {
  return BLACKLISTED_CIDRS.some((cidr) => {
    const [network, prefixStr] = cidr.split('/');
    const prefix = Number(prefixStr);
    return ipToPrefix(ip, prefix) === ipToPrefix(network, prefix);
  });
}
