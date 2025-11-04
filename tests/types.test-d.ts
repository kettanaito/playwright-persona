import { it, expectTypeOf } from 'vitest'
import { test as testBase } from '@playwright/test'
import {
  definePersona,
  combinePersonas,
  type AuthenticateFunction,
} from '../src/index.js'

it('combines multiple personas', () => {
  const user = definePersona('user', {
    createSession: async () => ({ user: { id: 'abc-123' } }),
    verifySession: async () => {},
  })
  const userWithTags = definePersona('user-with-tags', {
    createSession: async () => ({
      user: { id: 'abc-123', tags: [1, 2, 3] },
    }),
    verifySession: async () => {},
  })

  testBase.extend<{
    authenticate: AuthenticateFunction<[typeof user, typeof userWithTags]>
  }>({
    authenticate: combinePersonas(user),
  })('', async ({ authenticate }) => {
    expectTypeOf(authenticate)
      .parameter(0)
      .toHaveProperty('as')
      .toEqualTypeOf<'user' | 'user-with-tags'>()

    expectTypeOf(authenticate({ as: 'user' })).resolves.toEqualTypeOf<{
      user: { id: string }
    }>()

    expectTypeOf(
      authenticate({ as: 'user-with-tags' }),
    ).resolves.toEqualTypeOf<{
      user: { id: string; tags: Array<number> }
    }>()
  })
})

it('infers the session type across persona methods', () => {
  const user = definePersona('user', {
    async createSession() {
      return { user: 'abc-123' }
    },
    verifySession: async ({ session }) => {
      expectTypeOf(session).toEqualTypeOf<{ user: string }>()
    },
    destroySession: async ({ session }) => {
      expectTypeOf(session).toEqualTypeOf<{ user: string }>()
    },
  })
})

it('infers session return type from a defined persona', () => {
  const user = definePersona('user', {
    createSession: async () => ({ user: 'abc-123' }),
    verifySession: async () => {},
  })

  expectTypeOf<AuthenticateFunction<[typeof user]>>().returns.toEqualTypeOf<
    Promise<{ user: string }>
  >()
})
