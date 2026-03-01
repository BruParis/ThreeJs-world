import * as THREE from 'three';

/**
 * Projects a gradient vector onto the tangent plane of a sphere at a given position.
 * This gives you the "slope" direction along the sphere's surface.
 *
 * Useful for simulating water flow, erosion, or plate movement on spherical surfaces.
 *
 * @param gradient The 3D gradient vector to project
 * @param position The position on the sphere (used to compute the normal)
 * @returns A new Vector3 representing the tangential component of the gradient
 */
export function projectToTangentPlane(
    gradient: THREE.Vector3,
    position: THREE.Vector3
): THREE.Vector3 {
    const normal = position.clone().normalize();

    // Project out the normal component: gradient - (gradient · normal) * normal
    const dotProd = gradient.dot(normal);
    return new THREE.Vector3(
        gradient.x - dotProd * normal.x,
        gradient.y - dotProd * normal.y,
        gradient.z - dotProd * normal.z
    );
}

/**
 * Converts a gradient tuple [dx, dy, dz] to a THREE.Vector3.
 */
export function gradientToVector3(gradient: [number, number, number]): THREE.Vector3 {
    return new THREE.Vector3(gradient[0], gradient[1], gradient[2]);
}

/**
 * Converts spherical coordinates (latitude, longitude, radius) to Cartesian coordinates.
 *
 * @param lat Latitude in radians (-PI/2 to PI/2)
 * @param lon Longitude in radians (0 to 2*PI)
 * @param radius Sphere radius
 * @returns Cartesian position as Vector3
 */
export function sphericalToCartesian(lat: number, lon: number, radius: number = 1): THREE.Vector3 {
    return new THREE.Vector3(
        radius * Math.cos(lat) * Math.cos(lon),
        radius * Math.cos(lat) * Math.sin(lon),
        radius * Math.sin(lat)
    );
}

/**
 * Converts Cartesian coordinates to spherical (latitude, longitude, radius).
 *
 * @param position Cartesian position
 * @returns Object with lat, lon (in radians), and radius
 */
export function cartesianToSpherical(position: THREE.Vector3): { lat: number; lon: number; radius: number } {
    const radius = position.length();
    const lat = Math.asin(position.z / radius);
    const lon = Math.atan2(position.y, position.x);
    return { lat, lon, radius };
}
