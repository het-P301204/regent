import { describe, expect, it } from 'vitest'
import { bucketAddress } from '../src/security.ts'

describe('rate-limit client bucketing', () => {
  it('keeps IPv4 addresses as they are', () => {
    expect(bucketAddress('203.0.113.9')).toBe('203.0.113.9')
    expect(bucketAddress('::ffff:203.0.113.9')).toBe('203.0.113.9')
  })
  it('buckets IPv6 by /64 so rotating the interface id does not reset the limit', () => {
    expect(bucketAddress('2001:db8:1:2:aaaa:bbbb:cccc:dddd')).toBe('2001:db8:1:2::/64')
    expect(bucketAddress('2001:db8:1:2::1')).toBe('2001:db8:1:2::/64')
    expect(bucketAddress('2001:db8::1')).toBe('2001:db8:0:0::/64')
  })
})
