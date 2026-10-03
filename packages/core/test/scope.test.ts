import { describe, expect, it } from 'vitest'
import { covers, excess, intersect, isSubset, isValidPermission, minimal, parsePermission } from '../src/scope.ts'

describe('permission grammar', () => {
  it.each(['customer.read', 'customer.pii.read', 'invoice.*', 'a.b-c.d_e'])('accepts %s', (p) => {
    expect(isValidPermission(p)).toBe(true)
  })
  it.each(['*', 'customer', 'Customer.read', 'customer..read', 'customer.*.read', '.read', 'customer.read.', '', 'x'.repeat(200)])('rejects %s', (p) => {
    expect(isValidPermission(p)).toBe(false)
  })
  it('parses a trailing wildcard', () => {
    expect(parsePermission('customer.pii.*')).toEqual({ raw: 'customer.pii.*', valid: true, segments: ['customer', 'pii'], wildcard: true })
  })
})

describe('covers', () => {
  it('is reflexive', () => expect(covers('customer.read', 'customer.read')).toBe(true))
  it('lets a wildcard cover anything beneath it', () => {
    expect(covers('customer.*', 'customer.read')).toBe(true)
    expect(covers('customer.*', 'customer.pii.read')).toBe(true)
    expect(covers('customer.*', 'customer.pii.*')).toBe(true)
  })
  it('never lets a narrower wildcard cover a broader one', () => {
    expect(covers('customer.pii.*', 'customer.*')).toBe(false)
    expect(covers('customer.read', 'customer.*')).toBe(false)
  })
  it('does not match on a shared string prefix', () => {
    expect(covers('customer.*', 'customers.read')).toBe(false)
  })
  it('treats unparseable permissions as opaque literals', () => {
    expect(covers('*', 'customer.read')).toBe(false)
    expect(covers('*', '*')).toBe(true)
    expect(covers('customer.*', 'customer.*.write')).toBe(false)
  })
})

describe('set operations', () => {
  it('Child ⊆ Parent: equal scopes are contained', () => {
    expect(isSubset(['customer.read'], ['customer.read'])).toBe(true)
  })
  it('Child ⊆ Parent: narrower child is contained', () => {
    expect(isSubset(['customer.read'], ['customer.read', 'customer.write'])).toBe(true)
  })
  it('Child ⊄ Parent: wider child is not contained, and excess names the expansion', () => {
    expect(isSubset(['customer.read', 'customer.write'], ['customer.read'])).toBe(false)
    expect(excess(['customer.read', 'customer.write'], ['customer.read'])).toEqual(['customer.write'])
  })
  it('the empty scope is contained in everything', () => {
    expect(isSubset([], [])).toBe(true)
    expect(isSubset([], ['a.b'])).toBe(true)
  })
  it('intersect is the greatest lower bound', () => {
    expect(intersect(['customer.*'], ['customer.read', 'invoice.read'])).toEqual(['customer.read'])
    expect(intersect(['customer.*', 'invoice.read'], ['customer.pii.*'])).toEqual(['customer.pii.*'])
    expect(intersect(['a.b'], ['c.d'])).toEqual([])
  })
  it('intersect is commutative', () => {
    const a = ['customer.*', 'invoice.read', 'ledger.write']
    const b = ['customer.read', 'invoice.*', 'report.export']
    expect(intersect(a, b)).toEqual(intersect(b, a))
  })
  it('minimal drops covered entries and sorts by code point', () => {
    expect(minimal(['customer.read', 'customer.*', 'b.c', 'B.c'])).toEqual(['B.c', 'b.c', 'customer.*'])
  })
})
