import assert from 'node:assert/strict';
import test from 'node:test';
import { CONFIDENCE_THRESHOLD, flagReason, parseQuoteReply } from './parsing';

test('parses a plain English voice reply', () => {
  const parsed = parseQuoteReply('38500, toll extra');
  assert.equal(parsed.rate, 38500);
  assert.equal(parsed.tollIncluded, false);
  assert.ok(parsed.conditions.includes('Toll extra'));
  assert.ok(parsed.confidence >= CONFIDENCE_THRESHOLD, `confidence ${parsed.confidence}`);
});

test('parses shorthand rates like 41k', () => {
  const parsed = parseQuoteReply('rate 41k, toll extra');
  assert.equal(parsed.rate, 41000);
  assert.equal(parsed.tollIncluded, false);
});

test('parses comma grouped rates with a currency marker', () => {
  const parsed = parseQuoteReply('Rs. 39,500, all inclusive, vehicle ready tomorrow');
  assert.equal(parsed.rate, 39500);
  assert.equal(parsed.tollIncluded, true);
  assert.equal(parsed.availableOnDate, true);
  assert.ok(parsed.confidence >= CONFIDENCE_THRESHOLD, `confidence ${parsed.confidence}`);
});

test('parses a spoken amount written in words', () => {
  const parsed = parseQuoteReply('Fifteen thousand rupees, toll included');
  assert.equal(parsed.rate, 15000);
  assert.equal(parsed.tollIncluded, true);
});

test('parses a compound spoken amount', () => {
  assert.equal(parseQuoteReply('twenty five thousand five hundred only').rate, 25500);
  assert.equal(parseQuoteReply('one lakh twenty thousand rupees').rate, 120000);
});

test('a reply without a number yields no rate and low confidence', () => {
  const parsed = parseQuoteReply('Call me back, rate will be sent later');
  assert.equal(parsed.rate, null);
  assert.ok(parsed.confidence < CONFIDENCE_THRESHOLD);
  assert.equal(flagReason(parsed.rate, parsed.confidence, null), 'No rate could be parsed from the reply');
});

test('flags a rate far away from the rate card reference', () => {
  const parsed = parseQuoteReply('Rs. 95,000, all inclusive', 41500);
  assert.ok(parsed.confidence < 0.9);
  const flag = flagReason(parsed.rate, parsed.confidence, 41500);
  assert.ok(flag !== null && flag.includes('away from the rate card reference'), flag ?? 'expected a flag');
});

test('accepts a rate close to the rate card reference', () => {
  const parsed = parseQuoteReply('Rs. 41,000, all inclusive', 41500);
  assert.equal(flagReason(parsed.rate, parsed.confidence, 41500), null);
});

test('flags low confidence parses for an agent to verify', () => {
  const flag = flagReason(38000, 0.6, null);
  assert.ok(flag !== null && flag.includes('below'), flag ?? 'expected a flag');
});
