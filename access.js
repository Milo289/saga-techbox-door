'use strict';
// The login of the main account: a username and a hash of its password, sealed (see seal.js).
// It is fixed in the code. The program has no way to change it, and does not start if this file is missing or altered.
module.exports = {
  "username": "admin",
  "hash": "scrypt$73aa6c750b5b7d076d08b6f6f96135ee$78c1030b69743a65472c5a7a968d1715fb8d65559780a07187530d7ad46cf966ee0b408038dc321e1c3b9c7896fd0eae788494926466d8903f92dee72aa7b7fe",
  "check": "61b1c7ccaf6e0a0d972f5889dea7e8d02204b498832fc56ac283d5ac980bcd48"
};
