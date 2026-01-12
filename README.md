<h1 align="center">Playwright Persona 🎭</h1>
<p align="center">Authentication in <a href="https://playwright.dev/">Playwright</a> using personas.</p>

> [!IMPORTANT]
> There's an [official proposal](https://github.com/microsoft/playwright/issues/36540) opened to bring this API natively to Playwright. If you like what this library does and believe it can be a great addition to Playwright, please consider upvoting that proposal and sharing your thoughts in the referenced issue. Thank you!

## Motivation

Testing authentication-dependent behaviors requires you to set up authentication in your tests. Playwright comes with some great APIs and recommendations when it comes to [Authentication](https://playwright.dev/docs/auth). However, I found a few problems with the official recommendations:

- It's imperative. You have to (1) create a separate auth project; (2) describe the authentication steps there; (3) store and restore the session state manually; (4) mark a subset of tests dependent on that auth project. This feels more like orchestrating Playwright APIs than saying "authenticate as user XYZ".
- It promotes authentication as a part of a global test setup. I strongly believe that by doing so, authentication becomes a facilitator of a _shared state_ between test cases, leading to flakiness. You've got one test that adds an item to cart and another that ensures that the cart page is empty by default. If they happen to run with the same user but in the wrong order, one of them is bound to fail. Ouch!
- It's unopinionated. Arguably, as a low-level API should be! However, there are only a handful authentication strategies in tests and I believe this is a perfect place for strong opinions in favor of predictable experience.

And that's why `playwright-persona` exists—to address the issues above and also wrap the following best practices in a lean and accessible API:

1. **Declarative**. From how you define different user roles to the authentication literally becoming `await authenticate({ as: 'user' })` in your tests.
1. **Test case-based**. Every test case runs against a completely isolated authentication state. Unique users, unique sessions, no shared state.
1. **Performant**. Authenticating for each test case from ground up would be expensive. This package stores a successful authentication session on disk, verifies if that session is valid, then reuses it in tests without re-running the entire authentication flow.
1. **Flexible**. You can describe any possible [authentication recipes](#recipes) with this package. You can even reuse a single authentication setup for multiple tests if you so choose, but this is not encouraged.

## Usage

### 1. Install

First, install the `playwright-persona` package as a dependency in your project:

```sh
npm i playwright-persona --save-dev
```

#### Ignore sessions directory

> [!WARNING]
> This library persists successful sessions in the `./playwright/.auth` directory. **You MUST ignore that directory in Git** as it will contain sensitive information.

```sh
echo $'\nplaywright/.auth' >> .gitignore
```

### 2. Define personas

Next, define the personas for your application. A persona is a user role that can interact with your app. Each persona requires three arguments:

- `name`, the name of the persona;
- `createSession`, a function that describes the steps necessary to authenticate as this persona and returns a _session object_;
- `verifySession`, a function that verifies if the given authenticated session is valid.

Use the `definePersona` function from this package to define a new persona:

```ts
// tests/personas.ts
import { definePersona } from 'playwright-persona'

export const user = definePersona('user', {
  async createSession({ page }) {
    // 1. Define the test user.
    // Provide this via environment variables, query a database, etc.
    const user = {
      id: 'abc-123',
      username: 'john.doe',
    }

    // 2. Describe the authentication steps.
    // Use the Playwright's `page` function to automate flows
    // (or authenticate via an HTTP request).
    await page.goto('/login')
    await page.getByLabel(/Username/, user.username)
    await page.getByLabel(/Password/, 'supersecret')
    await page.getByRole('button', { name: /Log in/ }).click()

    // 3. Return a session object.
    // You can access this object in other persona methods
    // as well as in your test cases to perform session-based actions.
    return { user }
  },
  async verifySession({ page, session }) {
    await page.goto(`/users/${session.user.username}/notes`)
    await page.getByText(/My notes/).waitFor({ state: 'visible' })
  },
})
```

### 3. Create fixture

Next, create a new custom fixture called `authenticate`. The purpose of this fixture is to give you a declarative API to authenticate as any defined persona in your test cases.

Use the `combinePersonas` function exported from this package to quickly create the `authenticate` fixture:

```ts
// test-extend.ts
import { test as testBase, expect } from '@playwright/test'
import { combinePersonas, type AuthenticateFunction } from 'playwright-persona'
import { user } from './tests/personas'

// 1. Desribe the types of the new `authenticate` fixture.
interface Fixtures {
  authenticate: AuthenticateFunction<[typeof user]>
}

export const test = testBase.extend<Fixtures>({
  // 2. Implement the `authenticate` fixture by providing
  // it the result of calling `combinePersonas()` with all the
  // personas you want to be available in your tests.
  authenticate: combinePersonas(user),
})

export { expect }
```

### 4. Authenticate in tests

Finally, use the `authenticate` fixture to authenticate as any defined persona in any test case.

```ts
// tests/notes.test.ts
import { test, expect } from '../test-extend'

test('displays no notes for a new user', async ({ authenticate, page }) => {
  // Authenticate as any persona in this test.
  // And yes, both persona names and session objects are 100% type-safe! 🎉
  const session = await authenticate({ as: 'user' })

  await page.goto(`/notes/${session.user.username}/notes`)
  await expect(page.getByText('You have no notes')).resolves.toBeVisible()
})
```

## Session persistence

**Authenticated sessions are always persisted when using Playwright Persona**. This allows us to promote test case-based authentication while keeping your tests performant and not DDoS'ing your authentication provider on each test run.

Sessions are stored using the [`storageState`](https://playwright.dev/docs/api/class-apirequestcontext#api-request-context-storage-state) API in Playwright. Sessions are stored on the disk, in JSON files of a `${testId}-${personaName}.json` format. This means that each test case and each persona used in that test case yield unique session snapshots that can be reused later.

When you authenticate as a persona, the library first checks if the corresponding session snapshot exists on the disk. If it does, it reads it and provides it to your `verifySession` method to verify.

If the `verifySession` method resolves, the following happens:

1. The library applies the session snapshot directly to your browser context without re-running the `createSession` instructions.

If the `verifySession` method throws, indicating that the persisted session is stale, the following happens:

1. The optional `destroySession` method is called. Use this method to clean up any test resources related to the previous, stale session.
1. The `createSession` method is called, creating a new session and writing it to the disk again.

From here, it's rinse and repeat.

## Recipes

When setting up authentication in tests, there are two main factors: the test user and the session. The test user can be _fixed_ or _random_. The session can be _disposable_ or _persistent_. A combination of these factors creates a different authentication pattern with its ups and downs.

> [!WARNING]
> Sessions with Playwright Persona are _always_ persisted.

Playwright Persona allows you to mix and match these factors to craft the right authentication logic for your tests. Take a look at some of the examples below.

### Fixed test user

A common approach is to have a test user pre-created separately and authenticate as them as a part of your test setup (e.g. by storing the test user credentials in environment variables).

```ts
const user = definePersona('user', {
  async createSession({ page }) {
    await page.goto('/login')

    const session = await someAuthSdk.signIn({
      email: process.env.TEST_USER_EMAIL,
      password: process.env.TEST_USER_PASSWORD,
    })

    // If authenticating outside of the Playwright context,
    // manually forward the session cookies to the page.
    await page.context().addCookies(session.cookies)

    return session
  },
  async verifySession({ page, session }) {
    await someAuthSdk.session.verify({
      id: session.user.id,
    })
  },
})
```

In this example, the `user` persona signs in as the same user in every test via HTTP calls (`someAuthSdk` is made up! Use yours, if any). The test user here is _fixed_ and lives outside of the test.

### Random test user

A far more reliable approach is to use a random user for each authentication attempt.

```ts
const user = definePersona('user', {
  async createSession({ page }) {
    const user = await prisma.user.create({
      data: {
        id: randomId(),
        email: generateRandomEmail(),
        password: hashPassword('supersecret'),
        fullName: randomName()
      },
    })

    await page.goto('/login')
    await page.getByLabel(/Email/).fill(user.email)
    await page.getByLabel(/Password/).fill('supersecret')
    await page.getByRole('button', { name: /Log in/ }).click()

    return { user }
  },
  async verifySession({ page, session }) {
    await page.goto('/dashboard')
    await page.getByText(`Hi, ${session.user.fullName}!`)
  },
  async destroySession({ session }) {
    await prisma.user.delete({ where: { id: { session.user.id }}})
  }
})
```

Above, the `user` persona creates a random user in the database, then authenticates using their credentials in tests. Playwright Persona _persists the authentication state on disk_, so when you run your tests again, it uses the `verifySession` function to check if the persisted session is still valid. In our case, we are simply going to the `/dashboard` and asserting that the user greeting is visible and correct.

Finally, if the persisted session is invalid (or missing), the persona will create a new session. But here's a problem: the random user associated with the stale session _still exists in the database!_

To manage authentication-dependent resources, use the `destroySession` method of the persona. It will run then the library spots a stale session and allows you to clean up any resources associated with that session (the `session` value in this method points to the _stale_ session). For example, run a delete query in your database to delete the user associated with the previous session as they won't ever be reused again.

> [!IMPORTANT]
> You can extend the example above and introduce a _predictable randomness_ to your test users. One way to do that is by grabbing the second argument of `createSession`—the Playwright's `testInfo` object—and, say, using `testInfo.testId` as the test user's `id`.

### Shared authentication in all tests

Playwright Persona is not opinionated in where you integrate authentication into your test setup. For example, you can reuse the same authenticated state across the entire test run, which is similar to what Playwright recommends currently.

> [!WARNING]
> **This approach is not recommended**. By sharing authentication across multiple tests you are literally introducing a _shared state_.This is highly discouraged because this is a sure road to flaky tests.

First, create a special `auth.setup.ts` test that will use the `authenticate()` fixture to provision authentication once:

```ts
// tests/auth.setup.ts
import { test } from './test-extend'

test('authenticate', async ({ authenticate }) => {
  await authenticate({ as: 'user' })
})
```

Then, use the special `auth.setup.ts` project as a dependency for authentication-dependent tests:

```ts
// playwright.config.ts
export default defineConfig({
  projects: [
    { name: 'setup', testMatch /.*\.setup\.ts/ },

    {
      name: 'chromium',
      dependencies: ['setup'],
      use: { ...devices['Desktop Chrome'] }
    }
  ]
})
```

### Worker-scoped authentication

You can scope authentication to worker by implementing `authenticate` as [worker-scoped fixture](https://playwright.dev/docs/test-fixtures#worker-scoped-fixtures).

```ts
import { test as testBase } from '@playwright/test'
import { combinePersonas } from 'playwright-persona'
import { user } from './personas'

export const test = testBase.extend({
  authentication: [combinePersonas(user), { scope: 'worker' }],
})
```
