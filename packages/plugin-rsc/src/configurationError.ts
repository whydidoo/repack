export class RscConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RscConfigurationError';
  }
}
