
export async function resolve(spec, ctx, next) {
  if (["firebase/app","firebase/auth","firebase/firestore"].includes(spec)) {
    return { url: {"firebase/app":"file:///D:/grading-portal-web/fixture/firebase/app.js","firebase/auth":"file:///D:/grading-portal-web/fixture/firebase/auth.js","firebase/firestore":"file:///D:/grading-portal-web/fixture/firebase/firestore.js"}[spec], shortCircuit: true };
  }
  return next(spec, ctx);
}