import { defineMiddleware } from 'astro:middleware';

export const onRequest = defineMiddleware(({ url, redirect }, next) => {
  if (url.pathname.startsWith('/posts/')) {
    const newPath = url.pathname.replace('/posts/', '/blog/');
    return redirect(newPath, 301);
  }
  return next();
});
