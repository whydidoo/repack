const location = {
  host: `${__PUBLIC_HOST__}:${__PUBLIC_PORT__}`,
  hostname: __PUBLIC_HOST__,
  href: `${__PUBLIC_PROTOCOL__}://${__PUBLIC_HOST__}:${__PUBLIC_PORT__}/`,
  origin: `${__PUBLIC_PROTOCOL__}://${__PUBLIC_HOST__}:${__PUBLIC_PORT__}`,
  pathname: '/',
  port: __PUBLIC_PORT__,
  protocol: __PUBLIC_PROTOCOL__,
};

export function getDevServerLocation(): typeof location {
  return location;
}
