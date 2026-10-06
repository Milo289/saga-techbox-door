'use strict';
// The main account of this program: a username and a hash of the START password, sealed against changes.
// The program does not start without this file. Anyone who installs it logs in once with the start password
// and is then required to choose a password of their own (stored separately, in the data folder).
// Written by:  npm run login
module.exports = {
  "username": "admin",
  "hash": "scrypt$6d8cf79c831fc6403a484153ca5c55be$03893259fb567a9e2f615b818aa4f4c94210d7b726a8e853ad646e9a9976dfcf10b4a7af1d8672bcd70c06bd9283f6aba3be03108d3a657a204efda14c5c11e3",
  "check": "497c4df41209971dd750d13a511f84e37a15c96a002738fef5858e004c7fff4f"
};
