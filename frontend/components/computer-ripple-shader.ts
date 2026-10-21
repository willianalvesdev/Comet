// Character-wave shader identified in the installed Perplexity desktop build 26.10.2.
export const fragmentShader = `#version 300 es
precision highp float;

uniform vec2 u_size;
uniform vec3 u_tint;
uniform vec2 u_rippleOrigin;
uniform sampler2D u_glyphAtlas;
uniform float u_progress;
uniform float u_pixelRatio;
uniform vec4 u_maskRect;
uniform float u_maskRadius;

out vec4 fragColor;

const vec4 NOISE_C = vec4(
  0.211324865405187,
  0.366025403784439,
 -0.577350269189626,
  0.024390243902439
);

vec3 mod289(vec3 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec2 mod289(vec2 value) {
  return value - floor(value * (1.0 / 289.0)) * 289.0;
}

vec3 permute(vec3 value) {
  return mod289(((value * 34.0) + 1.0) * value);
}

float simplexNoise(vec2 value) {
  vec2 index = floor(value + dot(value, NOISE_C.yy));
  vec2 position = value - index + dot(index, NOISE_C.xx);
  vec2 offset = position.x > position.y ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 corners = position.xyxy + NOISE_C.xxzz;
  corners.xy -= offset;
  index = mod289(index);

  vec3 permutation = permute(
    permute(index.y + vec3(0.0, offset.y, 1.0))
      + index.x + vec3(0.0, offset.x, 1.0)
  );
  vec3 contribution = max(
    0.5 - vec3(
      dot(position, position),
      dot(corners.xy, corners.xy),
      dot(corners.zw, corners.zw)
    ),
    0.0
  );
  contribution *= contribution;
  contribution *= contribution;

  vec3 gradientX = 2.0 * fract(permutation * NOISE_C.www) - 1.0;
  vec3 gradientH = abs(gradientX) - 0.5;
  vec3 gradientOffset = floor(gradientX + 0.5);
  vec3 gradient = gradientX - gradientOffset;
  contribution *= 1.79284291400159
    - 0.85373472095314 * (gradient * gradient + gradientH * gradientH);

  vec3 result;
  result.x = gradient.x * position.x + gradientH.x * position.y;
  result.yz = gradient.yz * corners.xz + gradientH.yz * corners.yw;
  return 130.0 * dot(contribution, result);
}

float roundedRectDistance(vec2 point, vec4 rect, float radius) {
  vec2 center = (rect.xy + rect.zw) * 0.5;
  vec2 halfSize = max((rect.zw - rect.xy) * 0.5 - radius, vec2(0.0));
  vec2 delta = abs(point - center) - halfSize;
  return length(max(delta, 0.0)) + min(max(delta.x, delta.y), 0.0) - radius;
}

void main() {
  if (u_size.x <= 0.0 || u_size.y <= 0.0) {
    fragColor = vec4(0.0);
    return;
  }

  // Metal/SwiftUI uses a top-left origin; WebGL's fragment origin is bottom-left.
  vec2 position = vec2(gl_FragCoord.x, u_size.y - gl_FragCoord.y);
  vec2 uv = position / u_size;
  vec2 ripplePoint = vec2(
    (uv.x - u_rippleOrigin.x) * (u_size.x / u_size.y),
    uv.y - u_rippleOrigin.y
  );
  float rippleDistance = length(ripplePoint);
  float progress = clamp(u_progress, 0.0, 1.0);
  float motion = smoothstep(0.0, 1.0, progress);
  float rippleRadius = mix(0.045, 0.62, motion);
  float waveOffset = rippleDistance - rippleRadius;
  float pressureWave = exp(-pow(waveOffset / 0.078, 2.0));
  float outerPressureWave = 0.36 * exp(-pow((waveOffset - 0.105) / 0.058, 2.0));
  float displacementWave = clamp(pressureWave + outerPressureWave, 0.0, 1.0);
  float distanceBehindFront = max(-waveOffset, 0.0);
  float fadeIn = smoothstep(0.0, 0.10, progress);
  float fadeOut = 1.0 - smoothstep(0.36, 1.0, progress);
  float rippleEnvelope = fadeIn * fadeOut;
  float wake = smoothstep(0.0, 0.035, distanceBehindFront)
    * exp(-distanceBehindFront / 0.32);

  vec2 radialVector = position - u_size * u_rippleOrigin;
  float radialLength = max(length(radialVector), 0.001);
  vec2 radialDirection = radialVector / radialLength;
  float displacement = 7.0 * u_pixelRatio * rippleEnvelope * displacementWave;
  vec2 samplePosition = position - radialDirection * displacement;

  float spacing = 16.0 * u_pixelRatio;
  vec2 cellIndex = floor(samplePosition / spacing);
  vec2 cellUv = fract(samplePosition / spacing);
  float glyphNoise = simplexNoise(cellIndex * 0.31) * 0.5 + 0.5;
  float glyphIndex;
  if (glyphNoise < 0.32) {
    glyphIndex = 5.0;
  } else if (glyphNoise < 0.64) {
    glyphIndex = 6.0;
  } else if (glyphNoise < 0.73) {
    glyphIndex = 0.0;
  } else if (glyphNoise < 0.82) {
    glyphIndex = 1.0;
  } else if (glyphNoise < 0.89) {
    glyphIndex = 2.0;
  } else if (glyphNoise < 0.95) {
    glyphIndex = 3.0;
  } else {
    glyphIndex = 4.0;
  }

  vec2 glyphUv = vec2((glyphIndex + cellUv.x) / 7.0, cellUv.y);
  float glyphCoverage = texture(u_glyphAtlas, glyphUv).a;
  float variation = 0.90 + 0.10 * (simplexNoise(cellIndex * 0.17) * 0.5 + 0.5);
  float fieldFalloff = 1.0 - smoothstep(0.48, 0.68, rippleDistance);
  float fieldStrength = 0.62 * pressureWave + 0.42 * outerPressureWave
    + 0.24 * wake + 0.08 * fieldFalloff;
  vec2 iconFadeSpace = radialVector / (vec2(62.0, 50.0) * u_pixelRatio);
  float originFade = smoothstep(0.28, 1.0, length(iconFadeSpace));
  float animatedStrength = 1.10 * rippleEnvelope * fieldStrength;
  float opacity = originFade * animatedStrength * variation
    * (0.48 * glyphCoverage + 0.001);

  if (u_maskRect.z > u_maskRect.x && u_maskRect.w > u_maskRect.y) {
    float maskDistance = roundedRectDistance(position, u_maskRect, u_maskRadius);
    opacity *= smoothstep(-u_pixelRatio, u_pixelRatio, maskDistance);
  }

  fragColor = vec4(u_tint * opacity, opacity);
}
`;
