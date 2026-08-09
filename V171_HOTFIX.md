# v1.7.1 Hotfix

Fixes a server-side bug where `scanModels` was declared inside the pricing route instead of the identification route. This caused every Identify Card request to throw a ReferenceError and display the misleading clearer-photos error.

Replace only `server/server.js` in GitHub, commit, and let Render redeploy.
