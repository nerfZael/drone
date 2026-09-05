import { Skia } from "@shopify/react-native-skia";

export const miniPrismShader = Skia.RuntimeEffect.Make(`
  uniform float2 center;
  uniform float boxSize;
  uniform float time;
  uniform float phase;
  uniform float seed;
  uniform float opacity;
  uniform float pixelRatio;

  float3 rotateX(float3 point, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return float3(
      point.x,
      cosine * point.y - sine * point.z,
      sine * point.y + cosine * point.z
    );
  }

  float3 rotateY(float3 point, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return float3(
      cosine * point.x + sine * point.z,
      point.y,
      -sine * point.x + cosine * point.z
    );
  }

  float triangularPrismDistance(float3 point) {
    float3 absolutePoint = abs(point);
    float triangle = max(
      absolutePoint.x * 0.866025 + point.y * 0.5,
      -point.y
    ) - 0.46;
    return max(absolutePoint.z - 0.50, triangle);
  }

  float objectScale() {
    float growth = smoothstep(0.0, 0.14, phase);
    float release = 1.0 - smoothstep(0.90, 1.0, phase);
    return mix(0.16, 1.0, growth) * mix(0.55, 1.0, release);
  }

  float sceneDistance(float3 worldPoint) {
    float scale = objectScale();
    float3 point = worldPoint / scale;
    point = rotateY(point, -(time * 0.34 + seed * 2.7));
    point = rotateX(point, -(time * 0.21 + seed * 1.9));
    float droplet = length(point) - 0.53;
    float prism = triangularPrismDistance(point);
    float hardening = smoothstep(0.20, 0.36, phase);
    return mix(droplet, prism, hardening) * scale;
  }

  float3 sceneNormal(float3 point) {
    const float epsilon = 0.0020;
    const float3 directionA = float3(1.0, -1.0, -1.0);
    const float3 directionB = float3(-1.0, -1.0, 1.0);
    const float3 directionC = float3(-1.0, 1.0, -1.0);
    const float3 directionD = float3(1.0, 1.0, 1.0);
    return normalize(
      directionA * sceneDistance(point + directionA * epsilon)
      + directionB * sceneDistance(point + directionB * epsilon)
      + directionC * sceneDistance(point + directionC * epsilon)
      + directionD * sceneDistance(point + directionD * epsilon)
    );
  }

  float3 toneMap(float3 color) {
    return clamp(
      (color * (2.51 * color + 0.03))
        / (color * (2.43 * color + 0.59) + 0.14),
      0.0,
      1.0
    );
  }

  float3 spectralPalette(float phaseValue) {
    float position = fract(phaseValue) * 5.0;
    float blend = smoothstep(0.0, 1.0, fract(position));
    float3 indigo = float3(0.16, 0.04, 0.72);
    float3 cyan = float3(0.03, 0.82, 1.0);
    float3 chartreuse = float3(0.70, 1.0, 0.14);
    float3 coral = float3(1.0, 0.20, 0.10);
    float3 magenta = float3(0.96, 0.07, 0.82);

    if (position < 1.0) return mix(indigo, cyan, blend);
    if (position < 2.0) return mix(cyan, chartreuse, blend);
    if (position < 3.0) return mix(chartreuse, coral, blend);
    if (position < 4.0) return mix(coral, magenta, blend);
    return mix(magenta, indigo, blend);
  }

  half4 renderPrism(float2 position) {
    if (opacity < 0.001) return half4(0.0);

    float2 point = (position - center) / (boxSize * 0.5);
    point.y *= -1.0;
    float3 rayOrigin = float3(0.0, 0.0, 3.0);
    float3 rayDirection = normalize(float3(point * 1.35, -1.9));
    float scale = objectScale();
    float projection = dot(rayOrigin, rayDirection);
    float discriminant = projection * projection
      - (dot(rayOrigin, rayOrigin) - scale * scale * 0.82);
    float travel = 0.0;
    float hit = 0.0;

    if (discriminant > 0.0) {
      travel = max(0.0, -projection - sqrt(discriminant));

      for (int step = 0; step < 48; step += 1) {
        float distanceToScene = sceneDistance(rayOrigin + rayDirection * travel);
        if (distanceToScene < 0.0014) {
          hit = 1.0;
          break;
        }
        travel += max(distanceToScene * 0.72, 0.0025);
        if (travel > 4.2) break;
      }
    }

    if (hit < 0.5) return half4(0.0);

    for (int refinement = 0; refinement < 2; refinement += 1) {
      float refinedDistance = sceneDistance(rayOrigin + rayDirection * travel);
      travel += refinedDistance * 0.68;
    }

    float3 surfacePoint = rayOrigin + rayDirection * travel;
    float3 normal = sceneNormal(surfacePoint);
    float3 viewDirection = -rayDirection;
    float3 lightDirection = normalize(float3(-0.62, 0.85, 0.70));
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float specular = pow(
      max(dot(normal, normalize(lightDirection + viewDirection)), 0.0),
      28.0
    );
    float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0);
    float colorFlow = sin(surfacePoint.y * 5.5 - surfacePoint.x * 2.0 + time * 0.45)
      * 0.035;
    float palettePhase = 0.50 + normal.x * 0.18 + normal.y * 0.12
      + surfacePoint.y * 0.10 + time * 0.032 + seed * 0.08 + colorFlow;
    float3 material = spectralPalette(palettePhase);
    material *= 0.44 + diffuse * 0.64;
    material += float3(0.82, 0.94, 1.0) * specular;
    material += spectralPalette(palettePhase + 0.24) * fresnel * 0.52;
    material = toneMap(material);
    return half4(material * opacity, opacity);
  }

  half4 main(float2 position) {
    float sampleOffset = 0.28 / max(pixelRatio, 1.0);
    half4 color = renderPrism(position + float2(-sampleOffset, -sampleOffset));
    color += renderPrism(position + float2(sampleOffset, -sampleOffset));
    color += renderPrism(position + float2(-sampleOffset, sampleOffset));
    color += renderPrism(position + float2(sampleOffset, sampleOffset));
    return color * 0.25;
  }
`);
