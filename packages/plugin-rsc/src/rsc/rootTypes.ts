export type RscIdentityFieldValue =
  | string
  | number
  | boolean
  | bigint
  | null
  | undefined;

type IsAny<Value> = 0 extends 1 & Value ? true : false;

export type RscIdentityField<Props extends object> = {
  [Field in Extract<keyof Props, string>]-?: IsAny<Props[Field]> extends true
    ? never
    : [Props[Field]] extends [never]
      ? never
      : [Props[Field]] extends [RscIdentityFieldValue]
        ? Field
        : never;
}[Extract<keyof Props, string>];

export type RscReloadOn<Props extends object> = readonly [
  RscIdentityField<Props>,
  ...RscIdentityField<Props>[],
];

export type RscPendingPolicy = 'retain' | 'fallback';
