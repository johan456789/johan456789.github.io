// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightBlog from 'starlight-blog';

const isProd = process.env.NODE_ENV === 'production';
/** @typedef {{ tag: 'title' | 'base' | 'link' | 'style' | 'meta' | 'script' | 'noscript' | 'template', content?: string, attrs?: Record<string, string | boolean | undefined> }} HeadTag */
/** @type {HeadTag[]} */
const faviconHeadTags = [
	{
		tag: 'link',
		attrs: { rel: 'apple-touch-icon', sizes: '180x180', href: '/apple-touch-icon.png' },
	},
	{
		tag: 'link',
		attrs: { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon-32x32.png' },
	},
	{
		tag: 'link',
		attrs: { rel: 'icon', type: 'image/png', sizes: '16x16', href: '/favicon-16x16.png' },
	},
	{
		tag: 'link',
		attrs: { rel: 'manifest', href: '/site.webmanifest' },
	},
	{
		tag: 'link',
		attrs: { rel: 'mask-icon', href: '/safari-pinned-tab.svg', color: '#5bbad5' },
	},
	{
		tag: 'meta',
		attrs: { name: 'msapplication-TileColor', content: '#da532c' },
	},
	{
		tag: 'meta',
		attrs: { name: 'theme-color', content: '#ffffff' },
	},
];
/** @type {HeadTag[]} */
const posthogHeadTags = [
	{
		tag: 'script',
		content: `
!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
  posthog.init('phc_t9B7Ps1H8UdAfLrjgwwNsczWJp8Y3xaRB4MDgGdifRy', {
    api_host:'https://us.i.posthog.com',
    defaults: '2025-11-30'
  })
		`,
	},
];

// https://astro.build/config
export default defineConfig({
	site: 'https://tsunghanyu.com',
	markdown: {
		remarkRehype: { footnoteBackContent: '↑' },
	},
	integrations: [
		starlight({
			plugins: [starlightBlog()],
			title: 'Tsung-Han Yu',
			description: 'Personal website and blog of Tsung-Han Yu covering software engineering, learning notes, and technical explorations.',
			favicon: 'favicon.ico',
			customCss: ['./src/styles/global.css'],
			head: [...faviconHeadTags, ...(isProd ? posthogHeadTags : [])],
			social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/johan456789/johan456789.github.io' }],
			sidebar: [
				{
					label: 'Guides',
					items: [
						// Each item here is one entry in the navigation menu.
						{ label: 'Example Guide', slug: 'guides/example' },
					],
				},
				{
					label: 'Reference',
					autogenerate: { directory: 'reference' },
				},
			],
		}),
	],
	redirects: {
		"/posts": "/blog",
	}
});
