'use strict';

const { createAuditGate } = require('./audit');
const { createSecretScanGate } = require('./secret-scan');

function createFoundrySafetyHooks(opts = {}) {
  return {
    preDispatch: [createSecretScanGate(opts.secretScan || {})],
    postDispatch: [createAuditGate(opts.audit || {})],
  };
}

module.exports = {
  createFoundrySafetyHooks,
  createSecretScanGate,
  createAuditGate,
};
