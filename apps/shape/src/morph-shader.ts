import { Skia } from "@shopify/react-native-skia";

export const morphShader = Skia.RuntimeEffect.Make(`
  uniform float2 resolution;
  uniform float2 rotation;
  uniform float time;
  uniform float4 mitosis;
  uniform float morph;
  uniform float shape;
  uniform float pixelRatio;

  const float PI = 3.14159265;
  const float PHI = 1.61803399;

  float hash21(float2 point) {
    point = fract(point * float2(123.34, 345.45));
    point += dot(point, point + 34.345);
    return fract(point.x * point.y);
  }

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

  float boxDistance(float3 point, float3 bounds) {
    float3 delta = abs(point) - bounds;
    return length(max(delta, float3(0.0)))
      + min(max(delta.x, max(delta.y, delta.z)), 0.0);
  }

  float tetrahedronDistance(float3 point) {
    float3 normalA = normalize(float3(1.0, 1.0, 1.0));
    float3 normalB = normalize(float3(-1.0, -1.0, 1.0));
    float3 normalC = normalize(float3(-1.0, 1.0, -1.0));
    float3 normalD = normalize(float3(1.0, -1.0, -1.0));
    return max(
      max(dot(point, normalA), dot(point, normalB)),
      max(dot(point, normalC), dot(point, normalD))
    ) - 0.36;
  }

  float octahedronDistance(float3 point) {
    return (dot(abs(point), float3(1.0)) - 1.08) * 0.57735027;
  }

  float dodecahedronDistance(float3 point) {
    float3 normalA = normalize(float3(0.0, 1.0, PHI));
    float3 normalB = normalize(float3(0.0, -1.0, PHI));
    float3 normalC = normalize(float3(1.0, PHI, 0.0));
    float3 normalD = normalize(float3(-1.0, PHI, 0.0));
    float3 normalE = normalize(float3(PHI, 0.0, 1.0));
    float3 normalF = normalize(float3(-PHI, 0.0, 1.0));
    float distance = max(abs(dot(point, normalA)), abs(dot(point, normalB)));
    distance = max(distance, abs(dot(point, normalC)));
    distance = max(distance, abs(dot(point, normalD)));
    distance = max(distance, abs(dot(point, normalE)));
    distance = max(distance, abs(dot(point, normalF)));
    return distance - 0.67;
  }

  float icosahedronDistance(float3 point) {
    float inversePhi = 1.0 / PHI;
    float distance = abs(dot(point, normalize(float3(1.0, 1.0, 1.0))));
    distance = max(distance, abs(dot(point, normalize(float3(1.0, 1.0, -1.0)))));
    distance = max(distance, abs(dot(point, normalize(float3(1.0, -1.0, 1.0)))));
    distance = max(distance, abs(dot(point, normalize(float3(-1.0, 1.0, 1.0)))));
    distance = max(distance, abs(dot(point, normalize(float3(0.0, inversePhi, PHI)))));
    distance = max(distance, abs(dot(point, normalize(float3(0.0, -inversePhi, PHI)))));
    distance = max(distance, abs(dot(point, normalize(float3(inversePhi, PHI, 0.0)))));
    distance = max(distance, abs(dot(point, normalize(float3(-inversePhi, PHI, 0.0)))));
    distance = max(distance, abs(dot(point, normalize(float3(PHI, 0.0, inversePhi)))));
    distance = max(distance, abs(dot(point, normalize(float3(-PHI, 0.0, inversePhi)))));
    return distance - 0.70;
  }

  float triangularPrismDistance(float3 point) {
    float3 absolutePoint = abs(point);
    float triangle = max(
      absolutePoint.x * 0.866025 + point.y * 0.5,
      -point.y
    ) - 0.47;
    return max(absolutePoint.z - 0.57, triangle);
  }

  float hexagonalPrismDistance(float3 point) {
    float3 absolutePoint = abs(point);
    float hexagon = max(
      absolutePoint.x * 0.866025 + absolutePoint.y * 0.5,
      absolutePoint.y
    ) - 0.64;
    return max(absolutePoint.z - 0.55, hexagon);
  }

  float torusDistance(float3 point) {
    return length(float2(length(point.xz) - 0.56, point.y)) - 0.22;
  }

  float solidDistance(float3 point, float shapeIndex) {
    float index = mod(shapeIndex, 8.0);
    if (index < 0.5) return tetrahedronDistance(point);
    if (index < 1.5) return boxDistance(point, float3(0.55));
    if (index < 2.5) return octahedronDistance(point);
    if (index < 3.5) return dodecahedronDistance(point);
    if (index < 4.5) return icosahedronDistance(point);
    if (index < 5.5) return triangularPrismDistance(point);
    if (index < 6.5) return hexagonalPrismDistance(point);
    return torusDistance(point);
  }

  float blobDistance(float3 point, float seconds) {
    float lowFrequency = sin(point.x * 3.1 + seconds * 0.62)
      * sin(point.y * 3.7 - seconds * 0.48)
      * sin(point.z * 3.3 + seconds * 0.36);
    float highFrequency = sin(point.x * 5.2 - seconds * 0.24)
      * sin(point.y * 4.6 + seconds * 0.30)
      * sin(point.z * 5.5 - seconds * 0.21);
    float breathing = sin(seconds * 0.72) * 0.025;
    return length(point) - (0.72 + breathing + lowFrequency * 0.10 + highFrequency * 0.035);
  }

  float parentDistance(float3 point, float scale) {
    float3 scaledPoint = point / scale;
    float shapeFloor = floor(shape);
    float shapeBlend = smoothstep(0.0, 1.0, fract(shape));
    float solidA = solidDistance(scaledPoint, shapeFloor);
    float solidB = solidDistance(scaledPoint, shapeFloor + 1.0);
    float solid = mix(solidA, solidB, shapeBlend);
    float easedMorph = morph * morph * (3.0 - 2.0 * morph);
    return mix(solid, blobDistance(scaledPoint, time), easedMorph) * scale;
  }

  float mitosisAmount(float phaseValue) {
    if (phaseValue < 0.0 || phaseValue >= 0.22) return 0.0;
    return smoothstep(0.0, 0.10, phaseValue)
      * (1.0 - smoothstep(0.17, 0.22, phaseValue));
  }

  float smoothUnion(float distanceA, float distanceB, float radius) {
    float blend = clamp(0.5 + 0.5 * (distanceB - distanceA) / radius, 0.0, 1.0);
    return mix(distanceB, distanceA, blend) - radius * blend * (1.0 - blend);
  }

  float addBud(float scene, float3 point, float phaseValue) {
    if (phaseValue < 0.0 || phaseValue >= 0.20) return scene;
    float growth = smoothstep(0.0, 0.10, phaseValue);
    float radius = mix(0.025, 0.105, growth);
    float bud = length(point - mitosis.xyz) - radius;
    float unionRadius = mix(0.10, 0.006, smoothstep(0.075, 0.17, phaseValue));
    return smoothUnion(scene, bud, unionRadius);
  }

  float sceneDistance(float3 worldPoint) {
    float ambientRotation = time * 0.16;
    float3 point = rotateY(worldPoint, -(rotation.y + ambientRotation));
    point = rotateX(point, -rotation.x);

    float parentScale = 1.0 - mitosisAmount(mitosis.w) * 0.018;
    float scene = parentDistance(point, parentScale);
    return addBud(scene, point, mitosis.w);
  }

  float3 sceneNormal(float3 point) {
    const float epsilon = 0.0016;
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
    color = max(color, float3(0.0));
    return clamp(
      (color * (2.51 * color + 0.03))
        / (color * (2.43 * color + 0.59) + 0.14),
      0.0,
      1.0
    );
  }

  float3 spectralPalette(float phase) {
    float position = fract(phase) * 5.0;
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

  float3 backgroundColor(float2 position) {
    float2 screenUv = position / resolution;
    float vignette = 1.0 - smoothstep(0.18, 0.82, distance(screenUv, float2(0.5)));
    float3 background = mix(
      float3(0.012, 0.014, 0.035),
      float3(0.035, 0.025, 0.072),
      screenUv.y * 0.54 + vignette * 0.12
    );
    float grain = hash21(floor(position * 0.55)) - 0.5;
    return background + grain * 0.010;
  }

  float3 renderScene(float2 position, out float edgeMetric) {
    float shortestSide = min(resolution.x, resolution.y);
    float2 point = (position - resolution * 0.5) / shortestSide;
    point.y *= -1.0;
    float3 background = backgroundColor(position);

    float3 rayOrigin = float3(0.0, 0.0, 3.15);
    float3 rayDirection = normalize(float3(point * 1.72, -1.72));
    float travel = 0.0;
    float closest = 10.0;
    float hit = 0.0;
    float sphereProjection = dot(rayOrigin, rayDirection);
    float budGrowth = smoothstep(0.0, 0.10, mitosis.w);
    float budRadius = mix(0.025, 0.105, budGrowth);
    float boundRadius = mitosis.w < 0.0
      ? 1.10
      : max(1.10, length(mitosis.xyz) + budRadius + 0.10);
    float sphereDiscriminant = sphereProjection * sphereProjection
      - (dot(rayOrigin, rayOrigin) - boundRadius * boundRadius);

    if (sphereDiscriminant > 0.0) {
      travel = max(0.0, -sphereProjection - sqrt(sphereDiscriminant));

      for (int step = 0; step < 72; step += 1) {
        float3 samplePoint = rayOrigin + rayDirection * travel;
        float distanceToScene = sceneDistance(samplePoint);
        closest = min(closest, abs(distanceToScene));

        float hitEpsilon = max(0.00055, travel * 0.00052);
        if (distanceToScene < hitEpsilon) {
          hit = 1.0;
          break;
        }

        float marchScale = mix(0.94, 0.52, morph);
        travel += max(distanceToScene * marchScale, 0.0025);
        if (travel > 4.4) break;
      }
    }

    if (hit > 0.5) {
      for (int refinement = 0; refinement < 3; refinement += 1) {
        float refinedDistance = sceneDistance(rayOrigin + rayDirection * travel);
        travel += refinedDistance * mix(0.86, 0.58, morph);
      }

      float3 surfacePoint = rayOrigin + rayDirection * travel;
      float3 normal = sceneNormal(surfacePoint);
      float3 viewDirection = -rayDirection;
      float3 lightDirection = normalize(float3(-0.65, 0.82, 0.72));
      float3 halfDirection = normalize(lightDirection + viewDirection);

      float diffuse = max(dot(normal, lightDirection), 0.0);
      float secondary = max(dot(normal, normalize(float3(0.68, -0.25, 0.42))), 0.0);
      float specular = pow(max(dot(normal, halfDirection), 0.0), mix(46.0, 18.0, morph));
      float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.2);

      float colorFlow = sin(
        surfacePoint.y * 5.5 - surfacePoint.x * 2.0 + time * 0.45
      ) * 0.035;
      float palettePhase = 0.50 + normal.x * 0.18 + normal.y * 0.12
        + surfacePoint.y * 0.10 + time * 0.032 + colorFlow;
      float3 material = spectralPalette(palettePhase);
      material *= 0.42 + diffuse * 0.62;
      material += spectralPalette(palettePhase + 0.13) * secondary * 0.16;
      material += float3(0.82, 0.94, 1.0) * specular * 1.12;
      material += spectralPalette(palettePhase + 0.24) * fresnel * 0.62;
      material = toneMap(material);

      float fog = smoothstep(2.0, 4.8, travel) * 0.24;
      background = mix(material, background, fog);
      edgeMetric = abs(dot(normal, viewDirection));
    } else {
      float glow = exp(-closest * 18.0) * 0.16;
      background += spectralPalette(time * 0.032 + 0.08) * glow;
      edgeMetric = min(1.0, closest * 14.0);
    }

    return background;
  }

  half4 main(float2 position) {
    float edgeMetric = 1.0;
    float3 color = renderScene(position, edgeMetric);

    if (edgeMetric < 0.22) {
      float ignoredMetric = 1.0;
      float sampleOffset = 0.32 / max(pixelRatio, 1.0);
      float3 antialiasedColor = renderScene(
        position + float2(-sampleOffset, -sampleOffset),
        ignoredMetric
      );
      antialiasedColor += renderScene(
        position + float2(sampleOffset, -sampleOffset),
        ignoredMetric
      );
      antialiasedColor += renderScene(
        position + float2(-sampleOffset, sampleOffset),
        ignoredMetric
      );
      antialiasedColor += renderScene(
        position + float2(sampleOffset, sampleOffset),
        ignoredMetric
      );
      color = antialiasedColor * 0.25;
    }

    return half4(color, 1.0);
  }
`);
