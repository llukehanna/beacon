# Data layer

Screens read and write data through the hooks in `hooks.ts`. The hooks call a `DataAdapter`
(`adapter.ts`), and nothing else under `src/` calls `fetch`. The adapter in use comes from React
context and defaults to `restAdapter`, which talks to this app's own backend under `/api`.

## The hooks

The hook names and return fields follow the Foundry OSDK React hooks, so a screen reads the same
whichever backend is behind it.

| Hook                         | Reads or writes                  | Adapter method |
| ---------------------------- | -------------------------------- | -------------- |
| `useOsdkObjects(type, opts)` | A list of objects, paged         | `listObjects`  |
| `useOsdkQuery(name, params)` | A server query function          | `runFunction`  |
| `useLinks(source, link)`     | Objects at the far end of a link | `listLinked`   |
| `useOsdkAction(action)`      | One action                       | `applyAction`  |

Reads are cached by TanStack Query. A successful action refreshes the object types it reports
writing to, the links that touch them and every function result; an action that reports no types
refreshes everything. Screens never refetch by hand.

## The contract

```ts
interface DataAdapter {
  listObjects(type, opts?): Promise<Page<ObjectOf<T>>>;
  getObject(type, id): Promise<ObjectOf<T> | null>;
  listLinked(from, link, ids): Promise<Record<string, WireObject[]>>;
  applyAction(name, params): Promise<ActionResponse>;
  runFunction(name, params): Promise<FunctionResult<F>>;
}
```

- Object types, properties, links and action names come from `shared/schema.ts`. Action parameters
  come from `shared/actionParams.ts`; an object parameter is passed as the object's primary key.
  Query functions are listed with their parameters and results in `FunctionSignatures`.
- `listObjects` returns one page and a `nextPageToken`, which is null on the last page. `where` takes
  equality filters only. `pageSize` is capped by the backend (1000 here).
- `listLinked` takes several source keys at once and returns every linked object for each. It is not
  paged. A source with no links maps to an empty list.
- `applyAction` resolves with what the action created and modified and the object types it wrote
  to. It rejects when the action is refused or fails.
- Every call is made as the current persona. `restAdapter` sends it as the `X-Beacon-Persona`
  header (`persona.ts`). The persona is part of every query key, so switching it never shows
  another persona's cached data.
- A query function must be read-only. An action changes data; a function does not.

## Errors

Every failure rejects with an `Error`:

- `HttpError` has the `status` and, as its `message`, the `error` text the server sent, or a short
  sentence naming the status when the body had none.
- `NetworkError` means no answer arrived.

`errorMessage(error)` turns anything thrown into text for the screen: the server's text when there
is one, a sentence for a network failure, an `Error`'s message, a string as it is, and a generic
sentence for the rest. Screens show that, not `String(error)`.

Hooks return `error` as `Error | undefined`. `applyAction` from `useOsdkAction` also rejects, so a
caller that does not show `error` itself must catch it.

## Tests

`testing.ts` has `fakeAdapter`, which fills in the methods a test supplies and rejects on the rest,
and `pagedRows`, a `listObjects` that serves canned rows. A test provides the fake with
`DataAdapterProvider`; `hooks.adapter.test.tsx` does this for every hook.

## Replacing the backend

To run against Foundry, write a `DataAdapter` over the OSDK client and provide it once at the root,
around the app, in place of the default:

```tsx
<DataAdapterProvider value={foundryAdapter}>
  <RouterProvider router={router} />
</DataAdapterProvider>
```

The mapping from each method (names are the OSDK's concepts; check the exact calls against the SDK
version in use):

- `listObjects`: fetch a page of the object set for the type, with the page size, the page token as
  `pageToken`, the `where` filter and the ordering. Return the SDK's next page token as
  `nextPageToken`, or null on the last page.
- `getObject`: fetch one object by primary key, returning null when it is not found.
- `listLinked`: traverse the link from each source object and collect the results into a record
  keyed by source key. The REST adapter does this in one request; an OSDK adapter may need one call
  per key.
- `applyAction`: apply the action with edits returned, and build `created`, `modified` and `types`
  from the edits. If it leaves `types` out, everything refreshes, which is correct but slower.
- `runFunction`: execute the query function with the given parameters.

What the adapter has to do beyond calling the SDK:

- Reject with an `Error` whose `message` is readable. The Foundry error body has `errorName` and
  `message`; use `message`, and put the `errorName` in front of it if the message alone would be
  unclear.
- Return objects with `$apiName` and `$primaryKey` set, as the REST adapter does.
- Authenticate the user. The persona header is a demo mechanism and has no Foundry equivalent: a
  Foundry deployment gets the user from its own session, and access rules (markings, restricted
  views) apply on the Foundry side.

The OSDK object types, property names and action parameters are generated from the ontology, so an
adapter can check them against `shared/schema.ts` and `shared/actionParams.ts` at build time. The
`ontology.ts` tokens (`Firm`, `qualifyFirmAction`) are plain markers that the hooks read the API
name from. With the real SDK, import the generated types under the same names.
