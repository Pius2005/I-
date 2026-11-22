// Lightweight references to internal functions.
//
// Importing the generated internal object into a module that also defines
// functions makes TypeScript resolve the whole API type back through itself,
// which it reports as TS2589 / TS7022. These references carry the same
// module:function path without that cycle.

import { makeFunctionReference } from 'convex/server';
import type { FunctionType } from 'convex/server';

const ref = <T extends FunctionType>(path: string) => makeFunctionReference<T, any, any>(path);

export const internalRefs = {
  audit: {
    snapshot: ref<'action'>('audit:snapshot'),
  },
  auditData: {
    counterfactualBase: ref<'query'>('auditData:counterfactualBase'),
    snapshotRows: ref<'query'>('auditData:snapshotRows'),
  },
  auditWrites: {
    saveCounterfactual: ref<'mutation'>('auditWrites:saveCounterfactual'),
    saveReport: ref<'mutation'>('auditWrites:saveReport'),
  },
  auth: {
    applyPasswordReset: ref<'mutation'>('auth:applyPasswordReset'),
    consumeEmailToken: ref<'mutation'>('auth:consumeEmailToken'),
    createAccount: ref<'mutation'>('auth:createAccount'),
    createSession: ref<'mutation'>('auth:createSession'),
    findByEmail: ref<'query'>('auth:findByEmail'),
    getUserById: ref<'query'>('auth:getUserById'),
    issueEmailToken: ref<'mutation'>('auth:issueEmailToken'),
    logLogin: ref<'mutation'>('auth:logLogin'),
    markLogin: ref<'mutation'>('auth:markLogin'),
  },
  extract: {
    processCv: ref<'action'>('extract:processCv'),
  },
  files: {
    cvFileForApplication: ref<'query'>('files:cvFileForApplication'),
    markExtraction: ref<'mutation'>('files:markExtraction'),
    saveExtractedText: ref<'mutation'>('files:saveExtractedText'),
  },
  reminders: {
    send: ref<'mutation'>('reminders:send'),
  },
  secureData: {
    declaration: ref<'query'>('secureData:declaration'),
    deleteDeclaration: ref<'mutation'>('secureData:deleteDeclaration'),
    exportBundle: ref<'query'>('secureData:exportBundle'),
    recordExport: ref<'mutation'>('secureData:recordExport'),
    saveDeclaration: ref<'mutation'>('secureData:saveDeclaration'),
    seedDeclaration: ref<'mutation'>('secureData:seedDeclaration'),
  },
  settings: {
    current: ref<'query'>('settings:current'),
    jobForScoring: ref<'query'>('settings:jobForScoring'),
    jobScope: ref<'query'>('settings:jobScope'),
    orgScope: ref<'query'>('settings:orgScope'),
  },
};
