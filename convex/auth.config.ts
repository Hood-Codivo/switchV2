export default {
  providers: [
    {
      type: "customJwt" as const,
      issuer: "privy.io",
      jwks: `https://auth.privy.io/api/v1/apps/${process.env.NEXT_PUBLIC_PRIVY_APP_ID}/jwks.json`,
      algorithm: "ES256" as const,
      applicationID: process.env.NEXT_PUBLIC_PRIVY_APP_ID,
    },
  ],
}
