import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyDeviceSnapshot, type DeviceSnapshot } from './device';

function snapshot(overrides: Partial<DeviceSnapshot>): DeviceSnapshot {
  return {
    width: 1440,
    height: 900,
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    maxTouchPoints: 0,
    finePointer: true,
    coarsePointer: false,
    hover: true,
    ...overrides,
  };
}

test('classifies iPhone as mobile even when automation reports fine pointer and hover', () => {
  assert.equal(
    classifyDeviceSnapshot(snapshot({
      width: 393,
      height: 852,
      platform: 'iPhone',
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
      maxTouchPoints: 5,
      finePointer: true,
      coarsePointer: false,
      hover: true,
    })),
    'mobile',
  );
});

test('classifies Android phone as mobile before desktop pointer fallback', () => {
  assert.equal(
    classifyDeviceSnapshot(snapshot({
      width: 412,
      height: 915,
      platform: 'Linux armv8l',
      userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
      maxTouchPoints: 5,
      finePointer: true,
      coarsePointer: false,
      hover: true,
    })),
    'mobile',
  );
});

test('classifies iPadOS macOS platform shim as tablet', () => {
  assert.equal(
    classifyDeviceSnapshot(snapshot({
      width: 1194,
      height: 834,
      platform: 'MacIntel',
      userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1',
      maxTouchPoints: 5,
      finePointer: false,
      coarsePointer: true,
      hover: false,
    })),
    'tablet',
  );
});

test('keeps touch laptops in the desktop vertical', () => {
  assert.equal(
    classifyDeviceSnapshot(snapshot({
      width: 1366,
      height: 768,
      platform: 'Win32',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      maxTouchPoints: 10,
      finePointer: true,
      coarsePointer: false,
      hover: true,
    })),
    'desktop',
  );
});

test('uses viewport fallback when capability and user-agent signals are unavailable', () => {
  assert.equal(
    classifyDeviceSnapshot(snapshot({
      width: 390,
      height: 844,
      platform: '',
      userAgent: '',
      maxTouchPoints: 0,
      finePointer: false,
      coarsePointer: false,
      hover: false,
    })),
    'mobile',
  );
});
