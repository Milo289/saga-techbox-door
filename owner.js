'use strict';
// THE OWNER ACCOUNT — fixed in the code on purpose: one username, one password, no way to change it from the
// website, the settings or an environment variable. Only a HASH of the password is stored here, never the password.
//
// Fill it in with:   npm run owner        (asks for a username and password, writes this file)
// Change it later:   run it again, then restart the server / build the app again.
// While `hash` is empty there is no fixed owner and the PIN / OWNER_* settings are used instead.
module.exports = { username: '', hash: '' };
