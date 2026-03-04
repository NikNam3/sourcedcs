/**
 * MediaWiki:Citizen.js
 *
 * Forces the Citizen skin to always render in the light
 * (SOURCEDCS warm off-white) palette regardless of the
 * user's OS preference or any previously stored dark-mode
 * choice.
 *
 * This runs as early as possible (before the skin's own JS)
 * to prevent a flash of dark content (FODC).
 */
( function () {
	'use strict';

	var PREF_KEY     = 'skin-citizen-color-scheme';
	var COLOR_SCHEME = 'light';
	var ATTR_NAME    = 'data-mw-skin-color-scheme';

	/* 1. Set the DOM attribute immediately so CSS token overrides
	      in Citizen.css take effect before any paint. */
	document.documentElement.setAttribute( ATTR_NAME, COLOR_SCHEME );

	/* 2. Persist the preference so the skin's own init code
	      does not switch back to dark on subsequent loads. */
	try {
		localStorage.setItem( PREF_KEY, COLOR_SCHEME );
	} catch ( e ) {
		/* localStorage unavailable – safe to ignore */
	}

	/* 3. Once MediaWiki has loaded, update via the official
	      storage API too (belt-and-suspenders). */
	mw.loader.using( 'mediawiki.storage' ).done( function () {
		mw.storage.set( PREF_KEY, COLOR_SCHEME );

		/* Re-apply the attribute in case the skin JS ran
		   between step 1 and now and changed it. */
		document.documentElement.setAttribute( ATTR_NAME, COLOR_SCHEME );
	} );

}() );
