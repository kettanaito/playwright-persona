import { test, expectTypeOf, expect } from 'vitest'
import { test as testBase } from '@playwright/test'
import {
  definePersona,
  combinePersonas,
  type AuthenticateFunction,
} from '../src/index.js'

test('infers persona names', () => {
  const user = definePersona('user', {
    createSession: async () => ({}),
    verifySession: async () => {},
  })
  const admin = definePersona('admin', {
    createSession: async () => ({}),
    verifySession: async () => {},
  })

  testBase.extend<{
    authenticate: AuthenticateFunction<[typeof user, typeof admin]>
  }>({
    authenticate: combinePersonas(user),
  })('', async ({ authenticate }) => {
    expectTypeOf(authenticate)
      .parameter(0)
      .toHaveProperty('as')
      .toEqualTypeOf<'user' | 'admin'>()
  })
})

test('infers session return type', () => {
  const user = definePersona('user', {
    async createSession() {
      return { user: 'abc-123' }
    },
    verifySession: async ({ session }) => {
      expectTypeOf(session).toEqualTypeOf<{ user: string }>()
    },
  })

  testBase.extend<{
    authenticate: AuthenticateFunction<[typeof user]>
  }>({
    authenticate: combinePersonas(user),
  })('', async ({ authenticate }) => {
    const session = await authenticate({ as: 'user' })
    expectTypeOf(session).toEqualTypeOf<{ user: string }>()
  })
})
