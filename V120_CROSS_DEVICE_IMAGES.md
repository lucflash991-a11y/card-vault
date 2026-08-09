# Card Vault v1.2.0

This update fixes cards losing their photos when viewed on a different device.

Why it happened:
v1.0.6 intentionally stored card photos only in localStorage to avoid Firestore document-size failures. The card metadata synced, but the images did not.

New behavior:
- The device that scans the card keeps the original photos locally.
- Firestore receives compressed front/back thumbnails.
- Other signed-in devices load those cloud thumbnails.
- On the original device, the locally cached higher-quality originals override the cloud thumbnails.
