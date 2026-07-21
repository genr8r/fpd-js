// webpack.sash.config.js — one-shot production UMD bundle for vendoring into pkg_sash's
// modern WAM preset (com_sash.designer.modern). This is NOT the repo's own `npm run build`
// (that's `webpack --watch`, non-terminating, see SASH-NOTES.md "Deviation from brief Step 2")
// nor the gulp default task (which builds the *unmodified* dist/js/FancyProductDesigner.js for
// upstream/demo use). Run as a one-shot: `npx webpack -c webpack.sash.config.js`.
//
// Entry point: src/classes/FancyProductDesigner.js — same entry gulpfile.js's buildJS task uses
// (gulpfile.js:11-49), confirmed as the real production entry in SASH-NOTES.md's build survey.
// This config mirrors that task's babel/loader setup, adding:
//   - UMD library output (`window.FPD` global, via library.export: 'default' so the global IS
//     the FancyProductDesigner class itself, not `window.FPD.default`) for use from a plain
//     <script> tag on the Joomla page (loaded via WebAssetManager, no bundler on that side).
//   - resolve.alias stubs for modules Sash never enables: PricingRules (Options-driven pricing
//     UI Sash's own PHP pricing logic replaces) and the Facebook/Instagram/Pixabay third-party
//     image-picker integrations inside the Images module (all three are gated behind
//     mainOptions.facebookAppId / instagramClientId / pixabayApiKey — see
//     src/ui/controller/modules/Images.js:111-141 — which Sash's config never sets, so the
//     real classes are dead weight in the bundle). A shared no-op class stub
//     (src/sash-stub.js) satisfies every `new X(...)` call site for these.
const path = require('path');

const stub = path.resolve(__dirname, 'src/sash-stub.js');

module.exports = {
	mode: 'production',
	entry: './src/classes/FancyProductDesigner.js',
	output: {
		path: path.resolve(__dirname, 'dist-sash'),
		filename: 'fpd.sash.js',
		library: { name: 'FPD', type: 'umd', export: 'default' },
		globalObject: 'this',
	},
	module: {
		rules: [
			{
				test: /\.(js)$/,
				exclude: /node_modules/,
				use: {
					loader: 'babel-loader',
					options: {
						presets: [
							['@babel/preset-env', { targets: 'defaults' }]
						],
						plugins: ['@babel/plugin-transform-private-methods']
					}
				}
			},
			{
				test: /\.less$/,
				use: ['style-loader', 'css-loader', 'less-loader']
			},
			{
				test: /\.html$/i,
				loader: 'html-loader'
			}
		]
	},
	resolve: {
		alias: {
			[path.resolve(__dirname, 'src/classes/PricingRules.js')]: stub,
			[path.resolve(__dirname, 'src/ui/controller/modules/FacebookImages.js')]: stub,
			[path.resolve(__dirname, 'src/ui/controller/modules/InstagramImages.js')]: stub,
			[path.resolve(__dirname, 'src/ui/controller/modules/PixabayImages.js')]: stub
		}
	}
};
