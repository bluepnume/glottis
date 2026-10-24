// The two origins the dev server answers on, and the test pages on each.

export type TestEnv = {
    readonly origin : string,
    readonly foreignOrigin : string,
};

// The suite runs on `localhost`; the same server answers at the IPv6
// loopback literal, which the browser treats as a second origin.
export const getTestEnv = () : TestEnv => ({
    origin:        `http://localhost:${ location.port }`,
    foreignOrigin: `http://[::1]:${ location.port }`
});
