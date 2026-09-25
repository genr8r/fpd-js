const { src, dest, series } = require('gulp');
const uglify = require('gulp-uglify');
const less = require('gulp-less');
const concat = require('gulp-concat');
const cleanCSS = require('gulp-clean-css');
const webpack = require('webpack-stream');
const copy = require('gulp-copy');

const { createModule } = require('./gulp-tasks/createModule');
const { Transform } = require('stream');

function buildJS() {

    return src('./src/classes/FancyProductDesigner.js')
        .pipe(webpack({
            mode: 'production',
            module: {
                rules: [
                    {
                        test: /\.(js)$/,
                        exclude: /node_modules/,
                        use: {
                            loader: 'babel-loader',
                            options: {
                                presets: [
                                    ['@babel/preset-env', { targets: "defaults" }]
                                ],
                                plugins: ["@babel/plugin-transform-private-methods"]
                            }
                        }
                    },
                    {
                        test: /\.less$/,
                        use: [
                            "style-loader",
                            "css-loader",
                            "less-loader"
                        ]
                    },
                    {
                        test: /\.html$/i,
                        loader: "html-loader",
                    },
                ]
            }
        }))
        .pipe(concat('FancyProductDesigner.js'))
        .pipe(dest('dist/js/'));

}

function minifyJS() {

    return src(['./dist/js/FancyProductDesigner.js'])
        .pipe(uglify())
        .pipe(concat('FancyProductDesigner.min.js'))
        .pipe(dest('dist/js/'));

}

//sash fork (r10): com_sash's legacy stylesheet (loaded on the same page, after this CSS)
//declares its own `FontFPD` @font-face with different codepoints (v6's Position \e926 is a
//bin there) and a `[class^=fpd-icon-]{font-family:FontFPD!important}` rule. v6's icon font
//is therefore renamed `FontFPD6` (same font files) and every icon rule is scoped to v6's
//own elements, so it outranks a host's unscoped `.fpd-icon-*` rules there and leaves any
//`.fpd-icon-*` outside v6 elements alone. See SASH-NOTES.md §9.
const SASH_ICON_FAMILY = 'FontFPD6';
const SASH_ICON_SCOPE = ':is(.fpd-container, .fpd-modal-internal, fpd-element-toolbar, fpd-main-bar, fpd-actions-bar, fpd-views-nav, fpd-views-grid, fpd-main-wrapper)';

function sashScopeIconFont(css) {
    css = css.replace(/font-family:\s*'FontFPD'/g, `font-family: '${SASH_ICON_FAMILY}'`);
    return css.replace(/(^|})([^{}]+)\{/g, (match, close, selectors) => {
        if (selectors.trim().startsWith('@')) return match;
        const scoped = selectors.split(',').map((sel) => `${SASH_ICON_SCOPE} ${sel.trim()}`).join(', ');
        return `${close}\n${scoped} {`;
    });
}

function sashIconFont() {
    return new Transform({
        objectMode: true,
        transform(file, enc, cb) {
            if (file.isBuffer() && /FontFPD[\\/]style\.css$/.test(file.path)) {
                file.contents = Buffer.from(sashScopeIconFont(file.contents.toString()));
            }
            cb(null, file);
        },
    });
}

function buildVendorCSS() {

    return src(['./src/vendor/css/*.css', './src/vendor/FontFPD/style.css'])
        .pipe(sashIconFont())
        .pipe(cleanCSS())
        .pipe(concat('vendor.css'))
        .pipe(dest('dist/css/'));

}

function copyFontFiles() {

    return src('./src/vendor/FontFPD/fonts/*.*')
        .pipe(copy('dist/css/fonts/', { prefix: 4 }))
}

function buildCSS() {

    return src('./src/ui/less/main.less')
        .pipe(less())
        .pipe(cleanCSS())
        .pipe(concat('FancyProductDesigner.css'))
        .pipe(dest('./dist/css/'));

}

function combineCSS() {

    return src(['./dist/css/vendor.css', './dist/css/FancyProductDesigner.css'])
        .pipe(concat('FancyProductDesigner.min.css'))
        .pipe(dest('dist/css/'));

}

exports.buildJS = buildJS;
exports.minifyJS = minifyJS;
exports.buildCSS = buildCSS;
exports.buildVendors = series(buildVendorCSS, copyFontFiles);
exports.default = series(buildVendorCSS, copyFontFiles, buildJS, minifyJS, buildCSS, combineCSS);
exports.createModule = createModule;