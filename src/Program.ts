import { FetchHttpClient, HttpClient, HttpClientError, HttpClientRequest } from "@effect/platform";
import { Console, Context, Data, Effect, Layer, Ref } from "effect";

const API_1 = "http://localhost:3001/effect-tests/1";
const API_2 = "http://localhost:3001/effect-tests/2";
const API_3 = "http://localhost:3001/effect-tests/3";

const RENEW_URL = "http://localhost:3001/effect-tests/token-renew";

class APIError extends Data.TaggedError("APIError")<{
  readonly message: string;
  readonly status: number;
}> {}

class AuthToken extends Context.Tag("AuthToken")<
  AuthToken,
  {
    readonly token: Ref.Ref<string>;
  }
>() {}

const AuthTokenLive = Layer.effect(
  AuthToken,
  Ref.make("initial-token").pipe(Effect.map((tokenRef) => AuthToken.of({ token: tokenRef }))),
);

const makeAuthenticatedClient = Effect.gen(function*() {
  const client = yield* HttpClient.HttpClient;
  const { token } = yield* AuthToken;
  const currentToken = yield* Ref.get(token);

  return client.pipe(
    HttpClient.mapRequest(HttpClientRequest.setHeader("Authorization", currentToken)),
    HttpClient.filterStatus((status) => status < 400),
  );
});

const renewToken = Effect.gen(function*() {
  yield* Console.log("Renewing token...");
  const client = yield* HttpClient.HttpClient;
  const { token } = yield* AuthToken;
  const response = yield* client.post(RENEW_URL);
  const json = yield* response.json;

  const newToken = (json as { token: string; }).token;

  yield* Ref.set(token, newToken);
  yield* Console.log("token renewed");
}).pipe(
  Effect.catchAll(() =>
    Effect.fail(
      new APIError({
        message: "Token renewal failed",
        status: 0,
      }),
    )
  ),
);

const callAPI = (url: string) =>
  Effect.gen(function*() {
    const client = yield* makeAuthenticatedClient;

    const response = yield* client.get(url).pipe(
      Effect.catchAll((error) => {
        if (HttpClientError.isHttpClientError(error) && "response" in error) {
          const status = error.response.status;
          return Console.log(`API Error [${status}] at ${url}`).pipe(
            Effect.andThen(
              Effect.fail(
                new APIError({
                  message: `HTTP ${status} error at ${url}`,
                  status,
                }),
              ),
            ),
          );
        }

        return Console.log(`Network error at ${url}`).pipe(
          Effect.andThen(
            Effect.fail(
              new APIError({
                message: `Network error at ${url}`,
                status: 0,
              }),
            ),
          ),
        );
      }),
    );

    const json = yield* response.json.pipe(
      Effect.catchAll((_error) => {
        return Console.log(`JSON parse error at ${url}`).pipe(
          Effect.andThen(
            Effect.fail(
              new APIError({
                message: `Failed to parse JSON response at ${url}`,
                status: response.status,
              }),
            ),
          ),
        );
      }),
    );

    yield* Console.log(`Response from ${url}: ${json}`);

    return json;
  });

const retryWithRecovery = <A, E, R, RA, RE, RR>(
  effect: Effect.Effect<A, E, R>,
  recoveryAction: Effect.Effect<RA, RE, RR>,
  recoveryPredicate: (error: E) => boolean,
  retryPredicate: (error: E) => boolean,
  maxRetries: number,
): Effect.Effect<A, E | RE, R | RR> => {
  const attempt = (retriesLeft: number): Effect.Effect<A, E | RE, R | RR> =>
    effect.pipe(
      Effect.catchAll((e) => {
        if (retriesLeft > 0 && retryPredicate(e) && recoveryPredicate(e)) {
          return recoveryAction.pipe(Effect.andThen(attempt(retriesLeft - 1)));
        }
        if (retriesLeft > 0 && retryPredicate(e)) {
          return attempt(maxRetries - 1);
        }
        return Effect.fail(e);
      }),
    );
  return attempt(maxRetries);
};

const callAPI1 = retryWithRecovery(
  callAPI(API_1),
  renewToken,
  (e) => e.status === 401,
  (e) => e.status === 401,
  3,
);
const callAPI2 = retryWithRecovery(
  callAPI(API_2),
  renewToken,
  (e) => e.status === 401,
  () => true,
  3,
);
const callAPI3 = retryWithRecovery(
  callAPI(API_3),
  renewToken,
  (e) => e.status === 401,
  () => true,
  3,
);

const callAPIs = callAPI1.pipe(Effect.andThen(callAPI2), Effect.andThen(callAPI3));

const mergedLayer = Layer.merge(FetchHttpClient.layer, AuthTokenLive);

const program = callAPIs.pipe(
  Effect.provide(mergedLayer),
  Effect.catchAll((error) => Console.log(`Main operation failed: ${error.message}`)),
);

Effect.runPromise(program);
