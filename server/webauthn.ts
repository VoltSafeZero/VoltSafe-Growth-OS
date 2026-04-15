import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type { AuthenticatorTransportFuture } from "@simplewebauthn/server";
import type { Request } from "express";
import { db } from "./db";
import { webauthnCredentials, users } from "@shared/schema";
import { eq } from "drizzle-orm";

const rpName = "VoltSafe Growth OS";

function getRpConfig(req: Request) {
  const host = req.get("host") || "localhost:5000";
  const rpID = host.split(":")[0];
  const proto = req.get("x-forwarded-proto") || req.protocol || "https";
  const origin = `${proto}://${host}`;
  return { rpID, origin };
}

export async function getRegistrationOptions(userId: number, req: Request) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw new Error("User not found");

  const { rpID } = getRpConfig(req);

  const existingCreds = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));

  const options = await generateRegistrationOptions({
    rpName,
    rpID,
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    excludeCredentials: existingCreds.map((cred) => ({
      id: cred.credentialId,
      transports: cred.transports
        ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
        : undefined,
    })),
    authenticatorSelection: {
      residentKey: "preferred",
      userVerification: "preferred",
    },
  });

  req.session.webauthnRegChallenge = options.challenge;
  return options;
}

export async function verifyRegistration(
  userId: number,
  response: any,
  req: Request
) {
  const expectedChallenge = req.session.webauthnRegChallenge;
  if (!expectedChallenge) throw new Error("No registration challenge found. Please try again.");

  const { rpID, origin } = getRpConfig(req);

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error("Registration verification failed");
  }

  const { credential } = verification.registrationInfo;

  await db.insert(webauthnCredentials).values({
    userId,
    credentialId: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString("base64"),
    counter: credential.counter,
    transports: response.response?.transports
      ? JSON.stringify(response.response.transports)
      : null,
    deviceName: typeof response.deviceName === "string"
      ? response.deviceName.slice(0, 100)
      : "Biometric Device",
  });

  delete req.session.webauthnRegChallenge;
  return { verified: true };
}

export async function getAuthenticationOptions(req: Request, email?: string) {
  const { rpID } = getRpConfig(req);
  let allowCredentials: any[] = [];

  if (email) {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email.toLowerCase().trim()));
    if (user) {
      const creds = await db
        .select()
        .from(webauthnCredentials)
        .where(eq(webauthnCredentials.userId, user.id));
      allowCredentials = creds.map((cred) => ({
        id: cred.credentialId,
        transports: cred.transports
          ? (JSON.parse(cred.transports) as AuthenticatorTransportFuture[])
          : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID,
    userVerification: "preferred",
    allowCredentials:
      allowCredentials.length > 0 ? allowCredentials : undefined,
  });

  req.session.webauthnAuthChallenge = options.challenge;
  return options;
}

export async function verifyAuthentication(response: any, req: Request) {
  const expectedChallenge = req.session.webauthnAuthChallenge;
  if (!expectedChallenge) throw new Error("No authentication challenge found. Please try again.");

  const { rpID, origin } = getRpConfig(req);

  const allCreds = await db.select().from(webauthnCredentials);
  const matchedCred = allCreds.find(
    (c) => c.credentialId === response.id
  );

  if (!matchedCred) throw new Error("Credential not recognized. Please register your device first.");

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    credential: {
      id: matchedCred.credentialId,
      publicKey: new Uint8Array(
        Buffer.from(matchedCred.publicKey, "base64")
      ),
      counter: matchedCred.counter,
      transports: matchedCred.transports
        ? (JSON.parse(matchedCred.transports) as AuthenticatorTransportFuture[])
        : undefined,
    },
  });

  if (!verification.verified) {
    throw new Error("Biometric verification failed");
  }

  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter })
    .where(eq(webauthnCredentials.id, matchedCred.id));

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, matchedCred.userId));

  delete req.session.webauthnAuthChallenge;
  return { verified: true, user };
}

export async function getUserCredentials(userId: number) {
  return db
    .select({
      id: webauthnCredentials.id,
      deviceName: webauthnCredentials.deviceName,
      createdAt: webauthnCredentials.createdAt,
    })
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.userId, userId));
}

export async function deleteCredential(userId: number, credId: number) {
  const [cred] = await db
    .select()
    .from(webauthnCredentials)
    .where(eq(webauthnCredentials.id, credId));
  if (!cred || cred.userId !== userId) throw new Error("Credential not found");
  await db
    .delete(webauthnCredentials)
    .where(eq(webauthnCredentials.id, credId));
  return { deleted: true };
}
