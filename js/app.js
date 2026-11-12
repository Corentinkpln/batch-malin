const generateBtn = document.getElementById("generateBtn");
const results = document.getElementById("results");
const equipmentContainer = document.getElementById("equipmentContainer");

let equipments = [];

async function loadEquipments() {

    try {

        const response =
            await fetch("./data/equipment.json");

        equipments =
            await response.json();

        displayEquipments();

    } catch (error) {

        console.error(error);

        equipmentContainer.innerHTML =
            "Impossible de charger les équipements.";
    }
}

function displayEquipments() {

    equipmentContainer.innerHTML = "";

    equipments.forEach(equipment => {

        equipmentContainer.innerHTML += `
            <label class="equipment-card">
                <input
                    type="checkbox"
                    value="${equipment}">
                ${equipment}
            </label>
        `;
    });

}

function generateMenu() {

    const budget =
        document.getElementById("budget").value;

    const meals =
        document.getElementById("meals").value;

    const people =
        document.getElementById("people").value;

    const selectedEquipments =
        [...document.querySelectorAll(
            "#equipmentContainer input:checked"
        )].map(
            item => item.value
        );

    results.innerHTML = `
        <div class="result-card">

            <h3>✅ Menu généré</h3>

            <p><strong>Budget :</strong> ${budget} €</p>

            <p><strong>Repas :</strong> ${meals}</p>

            <p><strong>Personnes :</strong> ${people}</p>

            <p>
                <strong>Matériel :</strong>
                ${selectedEquipments.length
                    ? selectedEquipments.join(", ")
                    : "Aucun sélectionné"}
            </p>

        </div>
    `;
}

generateBtn.addEventListener(
    "click",
    generateMenu
);

loadEquipments();
