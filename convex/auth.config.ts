export default {
  providers: [
    {
      type: "customJwt",
      issuer: "privy.io",
      jwks: `https://auth.privy.io/api/v1/apps/${process.env.NEXT_PUBLIC_PRIVY_APP_ID}/.well-known/jwks.json`,
      algorithm: "ES256",
      applicationID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    },
  ],
}
