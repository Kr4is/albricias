from flask import Flask, render_template

app = Flask(__name__)


@app.route("/")
def home():
    """Render the current issue (home page)."""
    return render_template("home.html")


@app.route("/archive")
def archive():
    """Render the past editions archive."""
    issues = [
        {
            "id": "oct-24-2023",
            "date": "Tuesday, October 24, 2023",
            "date_short": "Oct 24",
            "vol": "CXLIII NO. 49",
            "no": "49",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuBp3_J4xTlbxtZw42osuYRDnHGOd68V4IJa_RWYpfIh4vfpy5Z722y_gXtCeyrHyz77I1cGAqKqr3puXjqr4tMfMBzfZsulCzp--KZj3bY_2b9E2AIW-I5HPj90Bv3iRbyRIb4QOwjPwHwMWi92l1tGn_836XzkN1_h2DBxM7H-OrHayMrdtzSgWsP6XV9MTSgrcjE2GTuYpM4fs970igX5Er1nRdKvs_1rO68D3UMuLm4Tu5rr2K-7XGo-2gV8gpbL2ST-8Fd7mmM",
            "lead_story": {
                "title": "Global Markets Rally as Inflation Cools",
                "content": "Global markets rally as inflation cools significantly in the third quarter. A deep dive into the changing economic landscape and what it means for the upcoming fiscal year.",
                "deck": "G",
            },
        },
        {
            "id": "oct-23-2023",
            "date": "Monday, October 23, 2023",
            "date_short": "Oct 23",
            "vol": "CXLIII NO. 48",
            "no": "48",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuDfp9cQ98MqHVYBu0P7yFLZXkyPkyZ6O3lP0btSLHsli-MSLMqAU4WZjBbTKwcdQJpQq5-_onXmHZXDknn8Qnv-ZsuLoMDmj-r2he4TV3akMi5ddalwvEtux9A-nAV4QqUzMh2vWDqUc3-nVBsDwXK74-qEOK784TpvnQXQ5ZcvLTE-lkQ2qdB87y6RYrV9BuVh1aPQZeurzNiElf0fV57TbtKB3ACsOfjfd9GoKJZB6ujNWHaOCUQcKugHFxLAqvUZ0XWok6zU2Z8",
            "lead_story": {
                "title": "New Infrastructure Plans Unveiled",
                "content": "New city infrastructure plans unveiled amidst heated council debate. Local residents voice concerns over traffic congestion and environmental impact in the downtown district.",
                "deck": "N",
            },
        },
        {
            "id": "oct-22-2023",
            "date": "Sunday, October 22, 2023",
            "date_short": "Oct 22",
            "vol": "CXLIII NO. 47",
            "no": "47",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuDOZb-BucUWnkyBXkzuJMGWuDexGbiopmZJNkS0BZyg1gn-4zGTwiP3XRenQZoIfJdg2qIlk6tnd4OTmWESoWp6Lj0HbeXO5SGe_l-POPeDrIMa88U1wiiBdt87pr3CvEMkVktx2pFFti5gv7kTvHd5yoBrOGKHioTT9NbleCR_t8hzsD60X-1FRXxs2vF6H7gdy2d86PwG2ZzsSOORgW6bjpBJ6RWYh_4xxeT1qJjkLjPRbNz760khkcL09DR7E4goiLTqJezDACw",
            "lead_story": {
                "title": "The Sunday Review: Modern Architecture",
                "content": "The Sunday Review: A retrospective on modern architecture and its role in shaping community interactions. Plus, the weekly literary supplement featuring emerging voices.",
                "deck": "T",
            },
        },
        {
            "id": "oct-21-2023",
            "date": "Saturday, October 21, 2023",
            "date_short": "Oct 21",
            "vol": "CXLIII NO. 46",
            "no": "46",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuCpCy1-Vudt-tEkgqUBq8d3zyjiCu8ZhqEStaZchTNYELowY4PVq3yr_qOBhzVi_mku_83qBvZQ5TMHayhv9pwWzYjiP_IaCqrC2R_fSRYM2IJ-gVfICi_V28M2bpJ0Xdf89wDYZeLiLiVT5aivD2jHwCbeUZysy97dT-QqAVLtu2qnylrhXlmoefqbSciFcktBYbFE-kD0cf-sEWSEKzTOHXLCaHh50vUAnZfuwxp-R2-KQi-L4bGTrkw52lKxxHmr4wGLWzLzhMM",
            "lead_story": {
                "title": "Weekend Arts & Leisure: Jazz Returns",
                "content": "Weekend Arts & Leisure: The return of classic jazz to the riverfront, and an interview with the director of the upcoming historical drama 'The Silent Era'.",
                "deck": "W",
            },
        },
        {
            "id": "oct-20-2023",
            "date": "Friday, October 20, 2023",
            "date_short": "Oct 20",
            "vol": "CXLIII NO. 45",
            "no": "45",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuD3QRggQzkGKPEQTS8b8IbyWQV2m23JDtHGZ-n-FUTNcTqLX3usCIGUAHhUF_XDwIz0dNeOtAkWlG9sM0KkREfkwUgFcd75EuzNettKTIbKUse0abV0ee3zMQpEvN9xTqPPrxA2wIQ0tPN6Q6T1zXJGRWQOfJhprlHWMWMTWJ179P1-pATsAYNITXDziwpyyNJGCXJ77yBDuCuoFLRSELVUHZvEnDzAu6yr7WNH_Fz2sJhGP9gHA6WdrxxLFcV9Rr1sNsWZCHFC5uI",
            "lead_story": {
                "title": "Environmental Summit Concludes",
                "content": "Environmental Summit concludes with historic agreement on forest preservation. Delegates from 40 nations sign the 'Green Canopy Accord'.",
                "deck": "E",
            },
        },
        {
            "id": "oct-19-2023",
            "date": "Thursday, October 19, 2023",
            "date_short": "Oct 19",
            "vol": "CXLIII NO. 44",
            "no": "44",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuB57aVKQneLskExES-briDtqKoprL4yp29eBjuI0iGjjGXjMTso20StSijwVfvhwrImwrYjAdQO71b5h_ru87H2BKUflZ8w-ZFjnCDzzdcf1vkeZNUNL6j6BVOEL6fcRZapOwEXkvOObPZXbQDPSR3KOwrugZJnmmuctvVTzNyd7rqghk6BoxkrAQWphKuHMkStE3LY04C9z1NmqlXNPJXoVSpuTlUU2wK8gssgq9l15gFe-zFSrUFTJLVO6n4zR3Y1lrbW9QeI4Jg",
            "lead_story": {
                "title": "Tech Giants Face New Scrutiny",
                "content": "Tech giants face new scrutiny over data privacy practices. The Senate committee hearing reveals surprising internal memos regarding user tracking.",
                "deck": "T",
            },
        },
        {
            "id": "oct-18-2023",
            "date": "Wednesday, October 18, 2023",
            "date_short": "Oct 18",
            "vol": "CXLIII NO. 43",
            "no": "43",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuBln_K-uPnfiwyICdjQUvmPXQpK-abhuOJic_qDira5quI09-eS7njQdlq_phznUWPFFb2bTnxauV4V2e6uhqTLykTdv6wFATIobRxGU03gzymZGenAydgRt8P-_Uq0oy33Zf33hKrXek-sz6IcX1BwNWj9001glMoeIFSjzbjSzq2WQ2I_VeP0Qgax2RzDOl5JqwvtR0vChHe61DsVhoIZDDKgxTzkDiYmDUReg3dAR2-BLrHsQVAtBTXGSatNWgVvgXGVJUpF9PU",
            "lead_story": {
                "title": "Education Reform Bill Passes",
                "content": "Education reform bill passes first hurdle. Teachers' unions express cautious optimism as funding allocation details emerge.",
                "deck": "E",
            },
        },
        {
            "id": "oct-17-2023",
            "date": "Tuesday, October 17, 2023",
            "date_short": "Oct 17",
            "vol": "CXLIII NO. 42",
            "no": "42",
            "cover_image": "https://lh3.googleusercontent.com/aida-public/AB6AXuAzqRGW94kzrMTacYLT_omXaX1g1rMXn1XPzcE2VRsVKMpBYViFCw6IClJgKlh3XWEoCVGGUoCuFfo2Kl6IHFv5qRC--cCtPEEi8TJlqJdDcI-01uqXHBxDYTLa2EywPdbJ4byV00g7e-qrbABI7JxGcl39OBZNFSN4ckFj7FwhMpjhA8XlXwCMn0XBEBV49bG-aCQZ1QJIPC0pFwumTN2mIStrSssbr3FyVFOS8LtgnarnzSz52wo9q6Fpz-dqAmCRQmQzgz-OHlc",
            "lead_story": {
                "title": "Urban Mobility in Focus",
                "content": "Urban mobility in focus: Commuters face delays as central station undergoes major renovation. An analysis of alternative routes.",
                "deck": "U",
            },
        },
    ]
    years = ["All Years", "2023", "2022", "2021", "2020"]
    return render_template("archive.html", issues=issues, years=years)


if __name__ == "__main__":
    app.run(debug=True)
