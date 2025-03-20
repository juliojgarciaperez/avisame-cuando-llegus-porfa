const express = require("express");
const morgan = require("morgan");
const uuid = require("uuid").v4;
const axios = require("axios");
const qs = require("qs");

const app = express();

const CLIENT_ID = process.env.CLIENT_ID;
const CLIENT_SECRET = process.env.CLIENT_SECRET;
const APP_URL = process.env.APP_URL;

let targets = [];

app.set("views", "./views");
app.set("view engine", "ejs");

app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

function sendMail(target) {
  console.log(`Send mail:`);

  console.log(
    `Hola ${target.email}! ${target.phone} ha llegado a su destino! https://www.google.com/maps/search/?api=1&query=${target.latitude},${target.longitude}`
  );

  targets = targets.filter((t) => t.id !== target.id);
}

setInterval(() => {
  targets
    .filter((t) => t.enabled)
    .forEach((target) => {
      console.log(
        "Checking target",
        target.phone,
        target.latitude,
        target.longitude
      );

      console.log(
        "POST https://sandbox.opengateway.telefonica.com/apigateway/location/v0/verify"
      );

      axios
        .post(
          "https://sandbox.opengateway.telefonica.com/apigateway/location/v0/verify",
          {
            ueId: {
              msisdn: target.phone,
            },
            latitude: target.latitude,
            longitude: target.longitude,
            accuracy: 2,
          },
          {
            headers: {
              Authorization: `Bearer ${target.token}`,
            },
          }
        )
        .then((response) => {
          const { verificationResult } = response.data;

          console.log("Verification result", verificationResult);

          if (verificationResult) {
            sendMail(target);
          }
        })
        .catch((error) => {
          console.error(error);
        });
    });
}, 60 * 1000);

app.get("/", (req, res) => {
  res.render("index");
});

app.get("/auth/cb", (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error) {
    console.error(error);
    return res.render("error", { error, error_description });
  }

  const target = targets.find(
    (target) => target.id === state || `NV_${target.id}` === state
  );

  const data = qs.stringify({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${APP_URL}/auth/cb`,
  });

  axios
    .post("https://sandbox.opengateway.telefonica.com/apigateway/token", data, {
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${CLIENT_ID}:${CLIENT_SECRET}`
        ).toString("base64")}`,
      },
    })
    .then((response) => {
      const token = response.data.access_token;

      if (state.startsWith("NV_")) {
        axios
          .post(
            "https://sandbox.opengateway.telefonica.com/apigateway/number-verification/v0/verify",
            {
              phoneNumber: target.email,
            }
          )
          .then((response) => {
            if (response.data.devicePhoneNumberVerified) {
              const msg = `Avísame cuando llegues porfapp!!

Visita el siguiente enlace para avisarme automáticamente cuando llegues a ${target.latitude}, ${target.longitude}.

${APP_URL}/${id}/avisapp
`;

              return res.redirect(`https://wa.me/${target.phone}?text=${msg}`);
            }
          })
          .catch((error) => {
            console.error(error);
            res.render("error");
          });
      } else {
        console.log("save token for target", target.id);

        target.token = token;
        target.enabled = true;

        res.render("success", { target });
      }
    })
    .catch((error) => {
      console.error(error);
      res.render("error");
    });
});

app.get("/:id/avisapp", (req, res) => {
  const { id } = req.params;
  const target = targets.find((target) => target.id === id);

  if (!target) {
    res.render("error", { message: "Target not found" });
  }

  res.redirect(
    `https://sandbox.opengateway.telefonica.com/apigateway/authorize?response_type=code&state=${id}&client_id=${CLIENT_ID}&scope=dpv%3AFraudPreventionAndDetection%23device-location-read&redirect_uri=${APP_URL}/auth/cb`
  );
});

app.post("/", (req, res) => {
  const { email, phone, latitude, longitude } = req.body;

  const id = uuid();

  const target = {
    email: email.startsWith("+34") ? email : `+34${email}`,
    phone: phone.startsWith("+34") ? phone : `+34${phone}`,
    latitude,
    longitude,
    id,
    enabled: false,
  };

  targets.push(target);

  res.redirect(
    `https://sandbox.opengateway.telefonica.com/apigateway/authorize?response_type=code&state=NV_${id}&client_id=${CLIENT_ID}&scope=dpv%3AFraudPreventionAndDetection%number-verification-verify-read&redirect_uri=${APP_URL}/auth/cb`
  );
});

app.listen(process.env.PORT || 3000, () => {
  console.log("Server is running on port 3000");
});
