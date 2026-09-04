import { Skia } from "@shopify/react-native-skia";

export const morphShader = Skia.RuntimeEffect.Make(`
  uniform float2 resolution;
  uniform float2 rotation;
  uniform float time;
  uniform float morph;
  uniform float shape;

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

  float sceneDistance(float3 worldPoint) {
    float ambientRotation = time * 0.16;
    float3 point = rotateY(worldPoint, -(rotation.y + ambientRotation));
    point = rotateX(point, -rotation.x);

    float shapeFloor = floor(shape);
    float shapeBlend = smoothstep(0.0, 1.0, fract(shape));
    float solidA = solidDistance(point, shapeFloor);
    float solidB = solidDistance(point, shapeFloor + 1.0);
    float solid = mix(solidA, solidB, shapeBlend);
    float easedMorph = morph * morph * (3.0 - 2.0 * morph);
    return mix(solid, blobDistance(point, time), easedMorph);
  }

  float3 sceneNormal(float3 point) {
    const float epsilon = 0.0025;
    float center = sceneDistance(point);
    return normalize(float3(
      sceneDistance(point + float3(epsilon, 0.0, 0.0)) - center,
      sceneDistance(point + float3(0.0, epsilon, 0.0)) - center,
      sceneDistance(point + float3(0.0, 0.0, epsilon)) - center
    ));
  }

  half4 main(float2 position) {
    float shortestSide = min(resolution.x, resolution.y);
    float2 screenUv = position / resolution;
    float2 point = (position - resolution * 0.5) / shortestSide;
    point.y *= -1.0;

    float vignette = 1.0 - smoothstep(0.18, 0.82, distance(screenUv, float2(0.5)));
    float3 background = mix(
      float3(0.012, 0.014, 0.035),
      float3(0.035, 0.025, 0.072),
      screenUv.y * 0.54 + vignette * 0.12
    );
    float grain = hash21(floor(position * 0.55)) - 0.5;
    background += grain * 0.010;

    float3 rayOrigin = float3(0.0, 0.0, 3.15);
    float3 rayDirection = normalize(float3(point * 1.72, -1.72));
    float travel = 0.0;
    float closest = 10.0;
    float hit = 0.0;
    float sphereProjection = dot(rayOrigin, rayDirection);
    float sphereDiscriminant = sphereProjection * sphereProjection
      - (dot(rayOrigin, rayOrigin) - 1.21);

    if (sphereDiscriminant > 0.0) {
      travel = max(0.0, -sphereProjection - sqrt(sphereDiscriminant));

      for (int step = 0; step < 72; step += 1) {
        float3 samplePoint = rayOrigin + rayDirection * travel;
        float distanceToScene = sceneDistance(samplePoint);
        closest = min(closest, abs(distanceToScene));

        if (distanceToScene < 0.0022) {
          hit = 1.0;
          break;
        }

        float marchScale = mix(0.94, 0.52, morph);
        travel += max(distanceToScene * marchScale, 0.0025);
        if (travel > 4.4) break;
      }
    }

    if (hit > 0.5) {
      float3 surfacePoint = rayOrigin + rayDirection * travel;
      float3 normal = sceneNormal(surfacePoint);
      float3 viewDirection = -rayDirection;
      float3 lightDirection = normalize(float3(-0.65, 0.82, 0.72));
      float3 halfDirection = normalize(lightDirection + viewDirection);

      float diffuse = max(dot(normal, lightDirection), 0.0);
      float secondary = max(dot(normal, normalize(float3(0.68, -0.25, 0.42))), 0.0);
      float specular = pow(max(dot(normal, halfDirection), 0.0), mix(46.0, 18.0, morph));
      float fresnel = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.2);

      float palette = 0.5 + 0.5 * normal.x;
      palette += normal.y * 0.16 + sin(surfacePoint.y * 3.0 + time * 0.25) * morph * 0.08;
      palette = clamp(palette, 0.0, 1.0);
      float3 cool = float3(0.09, 0.30, 1.0);
      float3 warm = float3(0.74, 0.20, 1.0);
      float3 material = mix(cool, warm, palette);
      material *= 0.44 + diffuse * 0.60 + secondary * 0.18;
      material += float3(0.65, 0.86, 1.0) * specular * 1.15;
      material += mix(float3(0.18, 0.30, 1.0), float3(0.72, 0.25, 1.0), palette)
        * fresnel * 0.68;

      float fog = smoothstep(2.0, 4.8, travel) * 0.24;
      background = mix(material, background, fog);
    } else {
      float glow = exp(-closest * 18.0) * 0.16;
      background += float3(0.20, 0.22, 1.0) * glow;
    }

    return half4(background, 1.0);
  }
`);
