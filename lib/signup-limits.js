// Per destination address, on the website form and the API alike: a signup sends a confirmation or a
// welcome email, so an address typed again and again must not turn the app into a mail bomb.
export const SIGNUPS_PER_ADDRESS = { name: "signup-address", limit: 3, window: "1 h" };
