// Infrastructure workspaces: schema templates per network + CAD→GIS mapping + text extraction + schema export
(function () {
  'use strict';
  const GV = window.GV; const { $, el } = GV;
  const F = (n, t) => ({ name: n, type: t || 'text' });
  const DIA = { field: 'DIAMETER', re: /(?:Ø|ø|DN\s*|D\s*=\s*|DIA\.?\s*|^|\s)(\d{2,4})\s*(?:mm|MM|م\.م)?(?=\s|$|[^\d])/, num: true };
  const MAT = { field: 'MATERIAL', re: /\b(DI|D\.I|HDPE|PE100|PE|UPVC|PVC|GRP|GRE|ST|STEEL|AC|CI|CU|AL|XLPE)\b/i, up: true };
  // real delivery schemas (taken from the GDBs the team actually delivers) + how CAD layers map to each class
  const REAL_SCHEMA = {"water": [{"name": "W_MAINLINE", "geom": "line", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["STARTXCOORDINATE", "real"], ["STARTYCOORDINATE", "real"], ["ENDXCOORDINATE", "real"], ["ENDYCOORDINATE", "real"], ["STARTPIPEGROUNDELEVATION", "real"], ["STARTPIPEELEVATION", "real"], ["ENDPIPEGROUNDELEVATION", "real"], ["ENDPIPEELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["DIAMETER", "int"], ["MATERIAL", "text"], ["NOMINALPRESSURE", "real"], ["CASINGTYPE", "text"], ["THRUSTPROTECTIONTYPE", "text"], ["MANUFACTURE", "text"], ["ACTUALLENGTH", "real"], ["Survey", "int"], ["SurveyDate", "date"], ["ConnectionType", "text"], ["ManufacturedDate", "text"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["ExternalCoating", "text"], ["CathodicProtection", "text"], ["InnerLining", "text"], ["InnerMaterial", "text"], ["InnerDiameter", "text"], ["OuterDiameter", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"]]}, {"name": "W_LATERALLINE", "geom": "line", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["STARTXCOORDINATE", "real"], ["STARTYCOORDINATE", "real"], ["ENDXCOORDINATE", "real"], ["ENDYCOORDINATE", "real"], ["STARTPIPEGROUNDELEVATION", "real"], ["STARTPIPEELEVATION", "real"], ["ENDPIPEGROUNDELEVATION", "real"], ["ENDPIPEELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["DIAMETER", "int"], ["MATERIAL", "text"], ["MANUFACTURE", "text"], ["ACTUALLENGTH", "real"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ConnectionType", "text"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["ExternalCoating", "text"], ["CathodicProtection", "text"], ["HaserArea", "text"], ["InnerLining", "text"], ["InnerMaterial", "text"], ["InnerDiameter", "text"], ["OuterDiameter", "text"], ["NominalPressure", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"], ["CasingType", "text"], ["ThrustProtectionType", "text"]]}, {"name": "W_ISOLATIONVALVE", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["OPERATIONMODE", "int"], ["PIPETYPE", "text"], ["DIAMETER", "int"], ["MATERIAL", "text"], ["ISBYPASS", "int"], ["TOTALTURNSTOCLOSE", "int"], ["CLOCKWISETOCLOSE", "int"], ["NOMINALPRESSURE", "real"], ["MANUFACTURE", "text"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ConnectionType", "text"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"]]}, {"name": "W_AIRRELEASEVALVE", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["OPERATIONMODE", "int"], ["PIPETYPE", "text"], ["DIAMETER", "int"], ["MATERIAL", "text"], ["TOTALTURNSTOCLOSE", "int"], ["CLOCKWISETOCLOSE", "int"], ["NOMINALPRESSURE", "real"], ["MANUFACTURE", "text"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ConnectionType", "text"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"]]}, {"name": "W_WASHOUTVALVE", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["OPERATIONMODE", "int"], ["PIPETYPE", "text"], ["DIAMETER", "int"], ["MATERIAL", "text"], ["TOTALTURNSTOCLOSE", "int"], ["CLOCKWISETOCLOSE", "int"], ["NOMINALPRESSURE", "real"], ["MANUFACTURE", "text"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ConnectionType", "text"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"]]}, {"name": "W_FIREHYDRANT", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["BARRELDIAMETER", "int"], ["MATERIAL", "text"], ["LATERALLENGTH", "real"], ["MANUFACTURE", "text"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"], ["NominalPressure", "text"], ["CoverMaterial", "text"], ["AboveGround", "text"], ["Protection", "text"], ["ProtectionAround", "text"]]}, {"name": "W_METERINGPOINT", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["DIAMETER", "int"], ["MATERIAL", "text"], ["HCN", "text"], ["DISCONCT", "int"], ["MANUFACTURE", "text"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"], ["XSITE", "real"], ["YSITE", "real"]]}, {"name": "W_JUNCTION", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["DIAMETER1", "int"], ["DIAMETER2", "int"], ["DIAMETER3", "int"], ["MATERIAL", "text"], ["NOMINALPRESSURE", "real"], ["CONNECTIONTYPE", "text"], ["MANUFACTURE", "text"], ["REMARKS", "text"], ["Survey", "int"], ["SurveyDate", "date"], ["ManufacturedDate", "date"], ["Visible", "text"], ["WaterType", "text"], ["ContractorNo", "text"], ["Contractor", "text"], ["Contract", "text"], ["LifeCycleStatus", "text"], ["BelowWaterTable", "int"], ["Consultant", "text"], ["Angel", "text"]]}, {"name": "CHAMBER", "geom": "point", "fields": [["ANCILLARYROLE", "int"], ["ENABLED", "int"], ["ASSETID", "text"], ["ASSETNAME", "text"], ["SERIALNUMBER", "text"], ["DISTRICT", "text"], ["STREETNAME", "text"], ["ASSETSTATUS", "text"], ["ASSETCONDITION", "text"], ["XCOORDINATE", "real"], ["YCOORDINATE", "real"], ["GROUNDELEVATION", "real"], ["ELEVATION", "real"], ["PROJECTID", "text"], ["PROXIMITYTONETWORK", "text"], ["COMMISSIONDATE", "date"], ["INSTALLDATE", "date"], ["FEATURETYPE", "text"], ["CHAMBERSHAPE", "text"], ["DIAMETER", "real"], ["LENGTH", "real"], ["WIDTH", "real"], ["DEPTH", "real"], ["REMARKS", "text"]]}], "storm": [{"name": "stwProposedNetwork", "geom": "line", "fields": [["LINE_ANNO", "text"], ["LINE_ID", "text"], ["US_MH_ID", "text"], ["DS_MH_ID", "text"], ["MATERIAL", "text"], ["WIDTH", "real"], ["HEIGHT", "real"], ["DIAMETER", "int"], ["CELL_NO", "int"], ["SLOPE", "real"], ["ROUGHNESS", "int"], ["US_PIPE_IL", "real"], ["DS_PIPE_IL", "real"], ["LENGTH", "real"], ["TYPE", "int"], ["STATUS", "text"], ["CLASSIFICATION", "int"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR_NAME", "text"], ["DESIGN_DATE", "text"], ["CONSTRUCTION_DATE", "text"], ["AMENDED_DATE", "text"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["REMARKS", "text"]]}, {"name": "stwProposedManhole", "geom": "point", "fields": [["MANHOLE_ANNO", "text"], ["MH_ID", "text"], ["COVER_LEVEL", "real"], ["INVERT_LEVEL", "real"], ["DEPTH", "real"], ["DIAMETER", "int"], ["WIDTH", "real"], ["LENGTH", "real"], ["X", "real"], ["Y", "real"], ["TYPE", "int"], ["STATUS", "text"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR_NAME", "text"], ["DESIGN_DATE", "text"], ["CONSTRUCTION_DATE", "text"], ["AMENDED_DATE", "text"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["REMARKS", "text"]]}, {"name": "stw_CatchBasin", "geom": "polygon", "fields": [["CATCHBASIN_ANNO", "text"], ["CATCHBASIN_ID", "text"], ["SIZE", "int"], ["STATUS", "text"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR_NAME", "text"], ["DESIGN_DATE", "date"], ["CONSTRUCTION_DATE", "date"], ["AMENDED_DATE", "date"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["ALTERED_DESIGN", "int"], ["REMARKS", "text"]]}, {"name": "stw_CatchBasin_pt", "geom": "point", "fields": [["CATCHBASIN_ANNO", "text"], ["CATCHBASIN_ID", "text"], ["SIZE", "int"], ["X", "real"], ["Y", "real"], ["STATUS", "text"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR_NAME", "text"], ["DESIGN_DATE", "date"], ["CONSTRUCTION_DATE", "date"], ["AMENDED_DATE", "date"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["ALTERED_DESIGN", "int"], ["REMARKS", "text"]]}, {"name": "stwChamber_Connection_Lines", "geom": "line", "fields": [["LINE_ANNO", "text"], ["LINE_ID", "text"], ["US_PIPE_IL", "real"], ["DS_PIPE_IL", "real"], ["LENGTH", "real"], ["STATUS", "text"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR", "text"], ["DESIGN_DATE", "date"], ["CONSTRUCTION_DATE", "date"], ["AMENDED_DATE", "date"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["ALTERED_DESIGN", "int"], ["REMARKS", "text"]]}, {"name": "stwJunctions", "geom": "point", "fields": [["JUNCTION_ANNO", "text"], ["JUNCTION_ID", "text"], ["STATUS", "text"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR_NAME", "text"], ["DESIGN_DATE", "date"], ["CONSTRUCTION_DATE", "date"], ["AMENDED_DATE", "date"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["ALTERED_DESIGN", "int"], ["REMARKS", "text"], ["x", "real"], ["y", "real"]]}, {"name": "stwExistingNetwork", "geom": "line", "fields": [["LINE_ANNO", "text"], ["DS_MH_ID", "text"], ["MATERIAL", "text"], ["WIDTH", "real"], ["HEIGHT", "real"], ["DIAMETER", "int"], ["CELL_NO", "int"], ["SLOPE", "real"], ["US_PIPE_IL", "real"], ["DS_PIPE_IL", "real"], ["LENGTH", "real"], ["TYPE", "int"], ["STATUS", "text"], ["CLASSIFICATION", "int"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR", "text"], ["DESIGN_DATE", "date"], ["CONSTRUCTION_DATE", "date"], ["AMENDED_DATE", "date"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["ALTERED_DESIGN", "int"], ["REMARKS", "text"]]}, {"name": "stwExistingManhole", "geom": "point", "fields": [["MANHOLE_ANNO", "text"], ["MH_ID", "text"], ["COVER_LEVEL", "real"], ["INVERT_LEVEL", "real"], ["DEPTH", "real"], ["DIAMETER", "int"], ["WIDTH", "real"], ["LENGTH", "real"], ["X", "real"], ["Y", "real"], ["TYPE", "int"], ["STATUS", "text"], ["DESIGN_CONSULTANT", "text"], ["SUPERVISION_CONSULTANT", "text"], ["CONTRACTOR_NAME", "text"], ["DESIGN_DATE", "date"], ["CONSTRUCTION_DATE", "date"], ["AMENDED_DATE", "date"], ["PROJECT_NAME", "text"], ["DATA_OWNER", "text"], ["DATA_SOURCE", "text"], ["ALTERED_DESIGN", "int"], ["REMARKS", "text"]]}], "lighting": [{"name": "Lighting_Poles", "geom": "point", "fields": [["Region_Name", "text"], ["Region__Number", "int"], ["Municipality_Name", "text"], ["Municipality_Number", "int"], ["Street_Name", "text"], ["Street_Number", "int"], ["PROVINCE_Name", "text"], ["X_Coordinates", "real"], ["Y_Coordinates", "real"], ["PANEL", "text"], ["Feed_Number", "int"], ["Pole_Condition", "text"], ["Pole_Type", "text"], ["Pole_Design", "text"], ["Poles_Earth", "text"], ["Bracket_Type", "text"], ["Phase_Color", "text"], ["Bracket_Form", "text"], ["Lamp1_Type", "text"], ["Lamp_Fact1", "text"], ["Lamp_Date1", "int"], ["Lamp1_Power", "int"], ["Light_Intensity1", "int"], ["Lamp2_type", "text"], ["Lamp2_Fact", "text"], ["Lamp2_Date", "int"], ["Lamp2_Power", "int"], ["Light2_Intensity", "int"], ["Lamp3_type", "text"], ["Lamp3_Fact", "text"], ["Lamp3_Date", "int"], ["Lamp5_Power", "int"], ["Light5_Intensity", "int"], ["Lamp6_type", "text"], ["Lamp6_Fact", "text"], ["Lamp6_Date", "int"], ["Lamp6_Power", "int"], ["Light6_Intensity", "int"], ["Lighting_Color_Tone", "text"], ["Pole_Door", "text"], ["Fuse_Box_Type", "text"], ["Fuse_Box_Status", "text"], ["Fuse_Box_Manfucturer", "text"], ["Fuse_Box_Installution_Date", "int"], ["Fuse_Switch_Typed", "text"], ["Fuse_Switch_Size", "int"], ["Fuse_Capacity_In_Plastic_Fuse_Box", "text"], ["Number_Of_Cables_In_Fuse_Box", "int"], ["Size_Of_Cable__In", "int"], ["Size_Of_Cable_Out", "int"], ["Cabel_Earthing", "text"], ["Earth_Rod_Connection", "text"], ["Filang_Condition", "text"], ["Foundation_Condition", "text"], ["Drop_Wire_Cabel_Manfucturer", "text"], ["Drop_Wire_Cabel_Installution_Date", "text"], ["Drop_Wire_Cabel_Connection_Assesment", "text"], ["Asset_Photos", "int"], ["STICKER_Photo", "text"], ["Photo_NoteS", "text"], ["Manfucturer_NAME", "text"], ["Manfucturer_Date", "int"], ["EXECUT_NAME", "text"], ["Comments", "text"], ["Asset_Number", "text"], ["Pole_Height", "text"]]}, {"name": "Cabels", "geom": "line", "fields": [["Asset_Number_", "text"], ["Region_Name_", "int"], ["Region_Number_", "text"], ["Municipality_Name_", "text"], ["Municipality_Number_", "int"], ["Street_Name_", "text"], ["Street_Number_", "int"], ["PROVINCE_Name_", "text"], ["ADDRES_", "text"], ["start_X_Coordinates_", "real"], ["Start_Y_Coordinates_", "real"], ["End_X_Coordinates_", "real"], ["End_Y_Coordinates_", "real"], ["PANEL_", "text"], ["Feed_Number_", "int"], ["Cabel_Number_", "text"], ["Rated_Voltage_", "text"], ["Cabel_lenghth_between_Pole_", "text"], ["Cross_Sectional_Area_", "int"], ["Cabel_Depth_", "int"], ["Cabel_Path_", "text"], ["Cabel_Manhoul_", "text"], ["Cabel_In_Pipe_", "text"], ["Number_of_Conductors_", "int"], ["Conductor_Material_", "text"], ["Insulation_Material_", "text"], ["Armoured_Non_Armoured_", "text"], ["Electrical_Conductor_", "text"], ["Cabel_Condition_Assesment_", "text"], ["Cabels_Test_", "text"], ["Cabel_Manfucturer_", "text"], ["Installution_Date_", "text"], ["Last_Maintenance_Date_", "text"], ["Waranty_", "text"]]}, {"name": "Lighting_Panel", "geom": "polygon", "fields": [["PANEL_Number", "text"], ["OLD_PANEL_Numbe", "text"], ["X_Coordinates", "real"], ["Y_Coordinates", "real"], ["Municipality_Name", "int"], ["Municipality_Number", "text"], ["Region_Name", "text"], ["Region_Number", "text"], ["PROVINCE_Name", "text"], ["STREET_Name", "text"], ["COUNTER_Number", "text"], ["SUBSCRIPTI", "text"], ["ELECT_READ", "text"], ["READ_DATE", "text"], ["ELECT_LOAD", "text"], ["ELECT_CLOAD", "text"], ["ELECT_BILL", "text"], ["STATION", "text"], ["Substation_Manufacturer", "text"], ["TRANSFORME", "text"], ["TRANSFOR_1", "text"], ["HAVE_CON", "text"], ["Substation_Name_Plate_Photo", "text"], ["Substaion_Actual_load", "text"], ["Substaion_Load_Balance", "text"], ["Substion_Oil_Change_Or_Test_Date", "date"], ["Trans_former_Oil_Level", "text"], ["Substaion_Warranty", "text"], ["Last_Substation_Miantenance_Date", "date"], ["panel_Manufacturer", "text"], ["Panel_Main_Breaker_Capacity", "text"], ["PANEL_DIST", "text"], ["Timer_Manfucturer", "text"], ["Timer_Condition", "text"], ["Photocell_Condition", "text"], ["Panel_Earth", "text"], ["Panel_Earth_Measuring", "text"], ["Panel_Locked", "text"], ["Feeding_Cable_Size", "text"], ["Concrete_Foundation", "text"], ["Foundation_Condition", "text"], ["Contactor1_Condition", "text"], ["Contactor2_Condition", "text"], ["Contactor1_Capacity", "text"], ["Contactor1_Type", "text"], ["Contactor2_Capacity", "text"], ["Contactor2_Type", "text"], ["CB_Manufacturer", "text"], ["CB1_Capacity", "text"], ["Cable_Feeder_Size1", "text"], ["Phase_1", "text"], ["Cable_Feeder_Load1", "text"], ["CB_Manufacturer_1", "text"], ["CB2_Capacity", "text"], ["Cable_Feeder_Size2", "text"], ["Phase_2", "text"], ["Cable_Feeder_Load2", "text"], ["CB_Manufacturer2", "text"], ["CB3_Capacity", "text"], ["Cable_Feeder_Size3", "text"], ["Phase_3", "text"], ["Cable_Feeder_Load_3", "text"], ["CB_Manufacturer3", "text"], ["CB4_Capacity", "text"], ["Cable_Feeder_Size_4", "text"], ["Phase__4", "text"], ["Cable_Feeder_Load_4", "text"], ["CB_Manufacturer_12", "text"], ["CB5_Capacity", "text"], ["Cable_Feeder_Size_5", "text"], ["Phase_5", "text"], ["Cable_Feeder_Load_5", "text"], ["CB_Manufacturer5", "text"], ["CB5_Capacity_1", "text"], ["Cable_Feeder_Size_56", "text"], ["Phase__6", "text"], ["Cable_Feeder_Load_6", "text"], ["CB6_Manufacturer", "text"], ["CB6_Capacity", "text"], ["Cable_Feeder_Size_6", "text"], ["Phase_7", "text"], ["Cable_Feeder_Load_7", "text"], ["CB_Manufacturer7", "text"], ["CB7_Capacity", "text"], ["Cable_Feeder_Size_7", "text"], ["Phase_8", "text"], ["Cable_Feeder_Load_8", "text"], ["CB_Manufacturer8", "text"], ["CB8_Capacity", "text"], ["Cable_Feeder_Size_8", "text"], ["Wall_Mounted_Pillar_Manfucture", "text"], ["Wall_Mounted_Pillar", "text"], ["Wall_Mounted_Pillar_Capacity", "text"], ["POLES_1", "text"], ["POLES_45", "text"], ["POLES_6", "text"], ["POLES_9", "text"], ["POLES_10", "text"], ["POLES_12", "text"], ["POLES_UP_LIGHT", "text"]]}]};
  const MAP = {
    W_MAINLINE: { re: /(main|prpl|pipe|w-?line|w-w-pipe|ir-pipe|irr.?st|خط|ماسورة)/i, not: /(lat|serv|hc\b|conn|house|text|iden|anno|dim)/i, text: [DIA, MAT] },
    W_LATERALLINE: { re: /(lat|serv|\bhc\b|house|conn|وصلة|توصيل)/i, text: [DIA, MAT] },
    W_ISOLATIONVALVE: { re: /(valve|vlv|valv|gate|isol|sluice|butter|\bgv\b|\bbv\b|bgv|surface box|محبس)/i, not: /(air|arv|\bav\b|wash|scour|\bwo\b|hydr)/i, text: [DIA] },
    W_AIRRELEASEVALVE: { re: /(air|arv|\bav\b|valv-air)/i, text: [DIA] },
    W_WASHOUTVALVE: { re: /(wash|scour|\bwo\b|valv-wash)/i, text: [DIA] },
    W_FIREHYDRANT: { re: /(hydrant|hydt|\bfh\b|fire|حريق)/i, text: [DIA] },
    W_METERINGPOINT: { re: /(meter|metr|عداد)/i },
    W_JUNCTION: { re: /(junction|fitt|tee|bend|reduc|\bred\b|-red\b|cap\b|plug|elbow|cross|sleev|saddle|sadl|coupl|qcv)/i, text: [DIA] },
    CHAMBER: { re: /(chamber|chmb|غرفة)/i },
    stwProposedNetwork: { re: /(storm|strm|\bsw\b|drain|pipe|main|@\s*\d{3,4}|ka-hyd-pipe)/i, not: /(culv|text|iden|conn|lead)/i, text: [DIA, MAT, { field: 'LINE_ID', re: /\b(P[-_ ]?\d+[A-Z]?)\b/, up: true }] },
    stwExistingNetwork: { re: /(exist|ext\b|موجود)/i, text: [DIA, MAT] },
    stwProposedManhole: { re: /(\bmh\b|mhol|manhol|chamber|node(?!.*(text|tabl|lab))|structure)/i, not: /(exist|text|tabl)/i, text: [{ field: 'MH_ID', re: /\b(MH[-_ ]?\w+)\b/i, up: true }] },
    stwExistingManhole: { re: /(exist.*(mh|manhol)|(mh|manhol).*exist)/i },
    stw_CatchBasin: { re: /(\bc\.?b\b|cb final|catch|gully|inlet|inlt)/i },
    stw_CatchBasin_pt: { re: /(\bc\.?b\b|cb final|catch|gully|inlet|inlt)/i },
    stwChamber_Connection_Lines: { re: /(connection|conn|lead|cb.?pipe|lateral|latr)/i, text: [DIA] },
    stwJunctions: { re: /(junction|jn\b)/i },
    Lighting_Poles: { re: /(pole|\blp\b|lt-?sym|e-lt|lum|lamp|عمود)/i, not: /(text|txt)/i, text: [{ field: 'Pole_Number', re: /\b(S?LP\d*[-_]\d+[-_]\d+)\b/i, up: true }] },
    Cabels: { re: /(cable|cabl|ltg|كابل)/i, text: [{ field: 'Cross_Sectional_Area_', re: /(\d\s*C\s*[xX×]\s*\d{1,3})/i, up: true }] },
    Lighting_Panel: { re: /(panel|panl|\bslp\d|feeder|e-pw-equ|لوحة)/i }
  };
  function real(id) { return (REAL_SCHEMA[id] || []).map(c => Object.assign({ name: c.name, geom: c.geom, fields: c.fields.map(([n, t]) => F(n, t)) }, MAP[c.name] || { re: new RegExp(c.name.replace(/^[A-Za-z]{1,3}_/, '').split(/[_\s]+/).filter(w => w.length > 2).join('|') || '^$', 'i') })); }
  const TPL = [
    { id: 'water', name: 'شبكة مياه (NWC)', icon: '💧', color: '#1c7ed6', classes: real('water') },
    { id: 'sewer', name: 'صرف صحي', icon: '🟤', color: '#8d6e63', classes: [
      { name: 'SS_GRAVITYMAIN', geom: 'line', re: /(sewer|sswr|gravity|main|pipe|صرف)/i, not: /(force|rising|lat|serv|hc|conn|text|iden)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('US_IL', 'real'), F('DS_IL', 'real'), F('SLOPE', 'real'), F('ACTUALLENGTH', 'real'), F('ASSETGROUP', 'int'), F('ASSETTYPE', 'int')], text: [DIA, MAT, { field: 'SLOPE', re: /S\s*=\s*([\d.]+)\s*%?/i, num: true }] },
      { name: 'SS_FORCEMAIN', geom: 'line', re: /(force|rising|\bfm\b)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('ACTUALLENGTH', 'real'), F('ASSETGROUP', 'int'), F('ASSETTYPE', 'int')], text: [DIA, MAT] },
      { name: 'SS_LATERAL', geom: 'line', re: /(lat|serv|hc|house|conn)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('ACTUALLENGTH', 'real')], text: [DIA, MAT] },
      { name: 'SS_MANHOLE', geom: 'point', re: /(\bmh\b|manhole|غرفة|chamber|inspection|\bic\b|clean)/i, fields: [F('MANHOLENO'), F('FEATURETYPE'), F('XCOORDINATE', 'real'), F('YCOORDINATE', 'real'), F('GROUNDELEVATION', 'real'), F('ELEVATION', 'real'), F('DEPTH', 'real'), F('DIAMETER', 'int'), F('ASSETGROUP', 'int'), F('ASSETTYPE', 'int')], text: [{ field: 'MANHOLENO', re: /\b((?:MH|IC|CO|JC)[-_ ]?[\w-]+)\b/i, up: true }, { field: 'GROUNDELEVATION', re: /(?:CL|GL|C\.L|G\.L|RL)\s*[=:]?\s*(-?\d+\.\d+)/i, num: true }, { field: 'ELEVATION', re: /(?:IL|I\.L|INV)\s*[=:]?\s*(-?\d+\.\d+)/i, num: true }] }] },
    { id: 'storm', name: 'تصريف أمطار (stw)', icon: '🌧', color: '#0c8599', classes: real('storm') },
    { id: 'power', name: 'كهرباء (جهد متوسط ومنخفض)', icon: '⚡', color: '#f08c00', classes: [
      { name: 'EL_MVCABLE', geom: 'line', re: /(\bmv\b|11\s?kv|13\.8|33\s?kv|medium)/i, fields: [F('VOLTAGE'), F('CABLESIZE'), F('CORES', 'int'), F('CONDUCTOR'), F('FEEDER'), F('ACTUALLENGTH', 'real')], text: [{ field: 'CABLESIZE', re: /(\d\s*[xX×]\s*\d{2,3})/ }, { field: 'CONDUCTOR', re: /\b(CU|AL)\b/i, up: true }] },
      { name: 'EL_LVCABLE', geom: 'line', re: /(\blv\b|0\.4|380|low|cable)/i, not: /(mv|text)/i, fields: [F('VOLTAGE'), F('CABLESIZE'), F('CORES', 'int'), F('CONDUCTOR'), F('FEEDER'), F('ACTUALLENGTH', 'real')], text: [{ field: 'CABLESIZE', re: /(\d\s*[xX×]\s*\d{2,3})/ }] },
      { name: 'EL_SUBSTATION', geom: 'point', re: /(\bsub|s\/s|substation|محطة|\bss\b)/i, fields: [F('SS_ID'), F('CAPACITY_KVA', 'int'), F('VOLTAGE'), F('X', 'real'), F('Y', 'real')], text: [{ field: 'SS_ID', re: /\b(S\/?S[-_ ]?\w+)\b/i, up: true }] },
      { name: 'EL_RMU', geom: 'point', re: /(\brmu\b|ring)/i, fields: [F('RMU_ID'), F('X', 'real'), F('Y', 'real')] },
      { name: 'EL_FEEDERPILLAR', geom: 'point', re: /(\bfp\b|pillar|mdb|\bdb\b)/i, fields: [F('FP_ID'), F('X', 'real'), F('Y', 'real')] }] },
    { id: 'lighting', name: 'إنارة شوارع (البلدية)', icon: '💡', color: '#fab005', classes: real('lighting') },
    { id: 'telecom', name: 'اتصالات', icon: '📡', color: '#7048e8', classes: [
      { name: 'TC_DUCT', geom: 'line', re: /(duct|telecom|comm|fib|\bft\b|stc)/i, fields: [F('DUCTCOUNT', 'int'), F('DUCTSIZE', 'int'), F('OWNER'), F('ACTUALLENGTH', 'real')], text: [{ field: 'DUCTCOUNT', re: /(\d+)\s*[wW]ay|(\d+)\s*[xX]\s*\d{2,3}/, num: true }] },
      { name: 'TC_MANHOLE', geom: 'point', re: /(\bmh\b|manhole|\bjb\b|joint)/i, fields: [F('MH_ID'), F('MH_TYPE'), F('X', 'real'), F('Y', 'real')] },
      { name: 'TC_HANDHOLE', geom: 'point', re: /(\bhh\b|handhole)/i, fields: [F('HH_ID'), F('X', 'real'), F('Y', 'real')] },
      { name: 'TC_CABINET', geom: 'point', re: /(cabinet|\bcab\b|fdh|olt)/i, fields: [F('CAB_ID'), F('X', 'real'), F('Y', 'real')] }] },
    { id: 'gas', name: 'غاز', icon: '🔥', color: '#e03131', classes: [
      { name: 'G_MAIN', geom: 'line', re: /(gas|ngas|main|pipe)/i, not: /(serv|text)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('PRESSURE'), F('ACTUALLENGTH', 'real')], text: [DIA, MAT] },
      { name: 'G_SERVICE', geom: 'line', re: /(serv|lat|hc)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('ACTUALLENGTH', 'real')], text: [DIA, MAT] },
      { name: 'G_VALVE', geom: 'point', re: /(valve|vlv)/i, fields: [F('VALVETYPE'), F('DIAMETER', 'int'), F('X', 'real'), F('Y', 'real')] },
      { name: 'G_REGULATOR', geom: 'point', re: /(regul|prs|drs)/i, fields: [F('REG_ID'), F('X', 'real'), F('Y', 'real')] }] },
    { id: 'irrigation', name: 'ري', icon: '🌱', color: '#2f9e44', classes: [
      { name: 'IR_MAINLINE', geom: 'line', re: /(irr|main|pipe)/i, not: /(lat|drip|text)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('ACTUALLENGTH', 'real')], text: [DIA, MAT] },
      { name: 'IR_LATERAL', geom: 'line', re: /(lat|drip|sub)/i, fields: [F('DIAMETER', 'int'), F('MATERIAL'), F('ACTUALLENGTH', 'real')], text: [DIA] },
      { name: 'IR_VALVE', geom: 'point', re: /(valve|vlv|solenoid)/i, fields: [F('VALVETYPE'), F('DIAMETER', 'int'), F('X', 'real'), F('Y', 'real')] },
      { name: 'IR_SPRINKLER', geom: 'point', re: /(sprink|emitter|bubbler|rotor|spray)/i, fields: [F('TYPE'), F('X', 'real'), F('Y', 'real')] },
      { name: 'IR_CONTROLLER', geom: 'point', re: /(control|clock)/i, fields: [F('CTRL_ID'), F('X', 'real'), F('Y', 'real')] }] }
  ];
  const GEOM_AR = { point: 'نقط', line: 'خطوط', polygon: 'مضلعات' };
  let cur = null; // {tpl, classes:[{...cls, sources:Set(layer), fmap:{field:{mode,val}} , circles:bool}], crs, textDist}

  function srcLayers() { return GV.sources.filter(s => s.id !== 'qc' && s.id !== 'field' && !s.wsOut && !s.isSchema && !GV.superseded(s) && !(s.orgOut && /\|bg$/.test(s.orgOut)) && !(s.isCad && !s.orgOut && GV.sources.some(o => o.orgOut === s.name + '|net'))).flatMap(s => s.layers.filter(l => l.features.length && l.leaf).map(l => ({ l, s }))); }
  function hasFam(l, fam) { return l.features.some(f => { const g = f.geometry; if (!g || f._sym) return false; if (f.properties && f.properties.Text != null) return false; const t = g.type.replace('Multi', ''); if (fam === 'point') return t === 'Point' || (t === 'LineString' && isSmallRing(g)); return t === (fam === 'line' ? 'LineString' : 'Polygon') || (fam === 'polygon' && t === 'LineString' && isClosed(g)); }); }
  function isClosed(g) { const c = g.type === 'LineString' ? g.coordinates : null; return c && c.length > 3 && Math.hypot(c[0][0] - c[c.length - 1][0], c[0][1] - c[c.length - 1][1]) < 1e-6; }
  function isSmallRing(g) { if (!isClosed(g)) return false; const c = g.coordinates; let mx = -Infinity, mn = Infinity, my = -Infinity, mny = Infinity; c.forEach(p => { mx = Math.max(mx, p[0]); mn = Math.min(mn, p[0]); my = Math.max(my, p[1]); mny = Math.min(mny, p[1]); }); return Math.max(mx - mn, my - mny) < 3; }
  function blockNames(l) { const s = new Set(); l.features.slice(0, 300).forEach(f => { if (f.properties && f.properties.Block) s.add(f.properties.Block); }); return Array.from(s).join(' '); }

  /* ---------- schema from an opened GDB / GPKG ---------- */
  function schemaSources() { return GV.sources.filter(s => s.layers.some(l => l.schema) || /Geodatabase|GeoPackage/.test(s.type || '')); }
  function tplFromSource(s) {
    return { id: 'custom', name: 'سكيما: ' + s.name, icon: '🗂', color: '#495057', custom: true, classes: s.layers.filter(l => l.schema || l.kind !== 'table').map(l => {
      const sc = l.schema || {}; const geom = sc.geom || (l.kind === 'point' ? 'point' : l.kind === 'polygon' ? 'polygon' : l.kind === 'line' ? 'line' : null);
      const fields = (sc.fields || GV.fieldsOf(l).map(n => ({ name: n, type: 'text' }))).filter(f => !/^(objectid|shape|shape_length|shape_area|globalid|fid)$/i.test(f.name));
      return { name: l.name, geom, fields, re: new RegExp('(' + l.name.replace(/^[A-Z]{1,3}_/i, '').split(/[_\s]+/).filter(w => w.length > 2).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')', 'i') };
    }).filter(c => c.geom) };
  }

  /* ---------- UI ---------- */
  const ALIAS = { MAIN: 'main pipe', SERV: 'service lat house', VALV: 'valve', HYDT: 'hydrant', SADL: 'saddle fitting', FITT: 'fitting', METR: 'meter', CHMB: 'chamber', GRAV: 'gravity main', FORC: 'force main', LATR: 'lateral', MHOL: 'manhole mh', INSP: 'inspection ic', CLNO: 'clean out', PIPE: 'pipe', CULV: 'culvert', INLT: 'inlet', OUTF: 'outfall', MVCB: 'mv cable', LVCB: 'lv cable', SUBS: 'substation', RMU: 'rmu', FPIL: 'pillar', POLE: 'pole', CABL: 'cable', PANL: 'panel', DUCT: 'duct', HHOL: 'handhole', CABN: 'cabinet', REGU: 'regulator', SPRK: 'sprinkler', CTRL: 'controller', IDEN: 'text' };
  function orgAlias(n) { const m = /^[A-Z]-[A-Z]{4}-([A-Z]{3,4})(?:-|$)/.exec(n); return m && ALIAS[m[1]] ? ALIAS[m[1]] : ''; }
  function open() {
    const box = $('#wsBody'); box.textContent = '';
    box.appendChild(el('p', 'muted small', 'اختار نوع الشبكة. كل بيئة فيها السكيما (الفيتشر كلاسز والحقول) وقواعد ربط طبقات الكاد واستخراج القيم من النصوص. وتقدر تستخدم السكيما الفاضية بتاعتك بدلها.'));
    const g = el('div', 'tpl-grid');
    TPL.forEach(t => { const b = el('button', 'tpl'); b.style.setProperty('--tc', t.color); b.append(el('span', 'tpl-i', t.icon), el('b', null, t.name), el('small', null, t.classes.map(c => c.name).join(' · '))); b.onclick = () => start(t); g.appendChild(b); });
    box.appendChild(g);
    const ss = schemaSources();
    const cs = el('div', 'step'); cs.appendChild(el('b', null, '🗂 السكيما بتاعتك'));
    if (ss.length) ss.forEach(s => { const b = el('button', 'crs-opt', 'استخدم سكيما ' + s.name + ' (' + s.layers.length + ' فيتشر كلاس)'); b.onclick = () => start(tplFromSource(s)); cs.appendChild(b); });
    else cs.appendChild(el('p', 'muted small', 'افتح الـ GDB الفاضي (مضغوط ZIP) أو GeoPackage بالسكيما بتاعتك من "افتح ملف"، وهيظهر هنا.'));
    box.appendChild(cs);
    $('#wsTitle').textContent = 'بيئات العمل'; GV.openSheet('#wsSheet');
  }
  function start(tpl) {
    const ls = srcLayers();
    if (!ls.length) return GV.showMsg('افتح ملف الكاد (DWG/DXF) أو الداتا الأول، وحدد نظام الإحداثيات بتاعها.');
    const crs = (ls.find(x => x.l.crsDef && /^(326|327|204)\d\d$/.test(String(x.l.crsDef))) || {}).l;
    const cur0 = tpl; tpl.classes.forEach(c => { if (tpl.custom && c.el === undefined) c.el = GV.netElemOf ? GV.netElemOf(c.name) : null; });
    cur = { tpl, crs: crs ? String(crs.crsDef) : '32638', textDist: 3, classes: tpl.classes.map(c => {
      const sources = new Set();
      ls.forEach(({ l, s }) => { if (s.flowTables || /^X-UNKN/.test(l.name)) return; const nm = l.name + ' ' + blockNames(l) + ' ' + orgAlias(l.name); if (!hasFam(l, c.geom)) return; if ((c.re && c.re.test(nm) && !(c.not && c.not.test(nm))) || (cur0 && cur0.custom && c.el && GV.netElemOf && GV.netElemOf(l.name) === c.el)) sources.add(l); else if (l.name.toLowerCase() === c.name.toLowerCase()) sources.add(l); });
      return Object.assign({}, c, { sources, circles: c.geom === 'point', fmap: {} });
    }) };
    // surveyed points from drawn coordinate tables fill point classes the drawing itself had nothing for
    cur.classes.forEach(c => { if (c.sources.size || c.geom !== 'point') return; GV.sources.filter(x => x.flowTables).forEach(x => x.layers.forEach(l => { const nm = l.name + ' ' + orgAlias(l.name); if (l.features.length && ((c.re && c.re.test(nm) && !(c.not && c.not.test(nm))) || (c.el && GV.netElemOf && GV.netElemOf(l.name) === c.el))) c.sources.add(l); })); });
    // one layer to one class only (first match wins, more specific first)
    const taken = new Map(); cur.classes.forEach(c => c.sources.forEach(l => { if (taken.has(l) && c.geom === taken.get(l).geom) { const prev = taken.get(l); const sp = cls => (cls.re ? cls.re.source.length : 0); if (sp(c) > sp(prev)) { prev.sources.delete(l); taken.set(l, c); } else c.sources.delete(l); } else taken.set(l, c); }));
    if (start._auto) return;
    renderMap();
  }
  function renderMap() {
    const box = $('#wsBody'); box.textContent = '';
    $('#wsTitle').textContent = cur.tpl.icon + ' ' + cur.tpl.name;
    const back = el('button', 'chip', '→ كل البيئات'); back.onclick = open; box.appendChild(back);
    const st = el('div', 'step'); st.appendChild(el('b', null, '1 · الإعدادات'));
    const r = el('div', 'row2');
    const cs = el('select'); GV.CRS_CHOICES.filter(c => c[0] !== '4326' && c[0] !== '3857').forEach(([v, t]) => { const o = el('option', null, t); o.value = v; cs.appendChild(o); }); cs.value = cur.crs; cs.onchange = () => cur.crs = cs.value;
    const td = el('input'); td.type = 'number'; td.step = '0.5'; td.value = cur.textDist; td.title = 'أقصى مسافة للنص من العنصر (م)'; td.oninput = () => cur.textDist = +td.value || 3;
    r.append(labeled('نظام الإحداثيات للمخرجات', cs), labeled('مسافة قراءة النصوص (م)', td)); st.appendChild(r); box.appendChild(st);
    const s2 = el('div', 'step'); s2.appendChild(el('b', null, '2 · ربط طبقات الكاد بالفيتشر كلاسز'));
    s2.appendChild(el('p', 'muted small', 'اتعلّم على الطبقات اللي اتربطت تلقائي حسب أسماء اللايرات والبلوكات. عدّل براحتك.'));
    const ls = srcLayers();
    cur.classes.forEach(c => {
      const card = el('div', 'fcard'); const top = el('div', 'fc-top'); top.append(el('span', 'fc-dot'), el('div', 'fc-name')); top.firstChild.style.background = cur.tpl.color;
      top.lastChild.append(el('b', null, c.name), el('small', 'muted', (GEOM_AR[c.geom] || '') + ' · ' + c.fields.length + ' حقل · ' + c.sources.size + ' طبقة مربوطة'));
      card.appendChild(top);
      const cand = ls.filter(({ l }) => hasFam(l, c.geom));
      const lst = el('div', 'cklist two');
      if (!cand.length) lst.appendChild(el('small', 'muted', 'مفيش طبقات فيها ' + GEOM_AR[c.geom]));
      cand.forEach(({ l, s }) => { const lab = el('label', 'ck small'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = c.sources.has(l); cb.onchange = () => { if (cb.checked) c.sources.add(l); else c.sources.delete(l); top.lastChild.lastChild.textContent = (GEOM_AR[c.geom] || '') + ' · ' + c.fields.length + ' حقل · ' + c.sources.size + ' طبقة مربوطة'; }; lab.append(cb, el('span', null, l.name), el('small', 'muted', ' ' + l.features.length)); lst.appendChild(lab); });
      card.appendChild(lst);
      if (c.geom === 'point') { const lab = el('label', 'ck small'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = c.circles; cb.onchange = () => c.circles = cb.checked; lab.append(cb, el('span', null, 'الدواير الصغيرة تتحول لنقط (مركزها)')); card.appendChild(lab); }
      const fb = el('button', 'chip', 'الحقول (' + c.fields.length + ')'); fb.onclick = () => renderFields(c, card, fb); card.appendChild(fb);
      s2.appendChild(card);
    });
    box.appendChild(s2);
    const used = new Set(); cur.classes.forEach(c => c.sources.forEach(l => used.add(l)));
    const un = ls.filter(({ l }) => !used.has(l) && !l.features.every(f => f.properties && f.properties.Text != null));
    if (un.length) { const w = el('div', 'cmp'); w.style.setProperty('--sc', '#f08c00'); w.appendChild(el('b', null, un.length + ' طبقة مش مربوطة بأي فيتشر كلاس')); w.appendChild(el('div', 'small', un.map(x => x.l.name).slice(0, 25).join('، '))); box.appendChild(w); }
    const go = el('button', 'open-btn', 'حوّل لـ GIS'); go.style.width = '100%'; go.style.justifyContent = 'center'; go.onclick = runConvert; box.appendChild(go);
  }
  function labeled(t, inp) { const l = el('label', 'fld'); l.appendChild(el('span', null, t)); l.appendChild(inp); return l; }
  function renderFields(c, card, btn) {
    let box = card.querySelector('.fmap'); if (box) { box.remove(); return; }
    box = el('div', 'fmap');
    const srcFields = new Set(); c.sources.forEach(l => GV.fieldsOf(l).forEach(k => srcFields.add(k)));
    c.fields.forEach(fd => {
      const m = c.fmap[fd.name] || { mode: 'auto' };
      const row = el('div', 'fm-row'); row.appendChild(el('span', 'fm-n', fd.name)); row.appendChild(el('small', 'muted', fd.type));
      const s = el('select'); [['auto', 'تلقائي'], ['empty', '— فاضي —'], ['const', 'قيمة ثابتة'], ['layer', 'رقم من اسم اللير']].concat(Array.from(srcFields).map(k => ['f:' + k, 'من حقل: ' + k])).forEach(([v, t]) => { const o = el('option', null, t); o.value = v; s.appendChild(o); });
      s.value = m.mode === 'field' ? 'f:' + m.val : m.mode;
      const inp = el('input'); inp.placeholder = 'القيمة'; inp.value = m.mode === 'const' ? m.val : ''; inp.style.display = m.mode === 'const' ? '' : 'none';
      const upd = () => { const v = s.value; inp.style.display = v === 'const' ? '' : 'none'; c.fmap[fd.name] = v.startsWith('f:') ? { mode: 'field', val: v.slice(2) } : { mode: v, val: inp.value }; };
      s.onchange = upd; inp.oninput = upd;
      row.append(s, inp); box.appendChild(row);
    });
    box.appendChild(el('p', 'muted small', 'تلقائي = بالترتيب: حقل بنفس الاسم ← حساب (الطول، X، Y، Z) ← نص كاد قريب (قطر، مادة، أرقام…) ← رقم من اسم اللير (زي C-WATR-PRPL-0160 = 160 للقطر).'));
    card.insertBefore(box, btn.nextSibling);
  }

  /* ---------- conversion ---------- */
  async function runConvert() {
    const fwdP = proj4('WGS84', GV.epsgDef(cur.crs)); const fwd = c => fwdP.forward([c[0], c[1]]);
    $('#busy').classList.add('show'); $('#busyText').textContent = 'بحوّل الكاد لـ GIS…'; await new Promise(r => setTimeout(r, 30));
    try {
      // collect CAD texts (all CAD sources) in target CRS
      const texts = []; GV.sources.filter(s => s.isCad).forEach(s => s.layers.forEach(l => l.features.forEach(f => { if (f.properties && f.properties.Text != null && f.wgs && f.wgs.geometry) { const p = fwd(f.wgs.geometry.coordinates); texts.push({ x: p[0], y: p[1], t: String(f.properties.Text), layer: l.name }); } })));
      const tg = new Map(); const cell = Math.max(cur.textDist, 1); texts.forEach((t, i) => { const k = Math.floor(t.x / cell) + ',' + Math.floor(t.y / cell); if (!tg.has(k)) tg.set(k, []); tg.get(k).push(i); });
      const nearTexts = (geom) => {
        const pts = []; const g = geom; const add = c => pts.push(c);
        if (g.type === 'Point') add(g.coordinates); else (g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : []).forEach(add);
        const res = []; const seen = new Set();
        const samples = pts.slice(); for (let k = 1; k < pts.length; k++) { const A = pts[k - 1], B = pts[k]; const L0 = Math.hypot(B[0] - A[0], B[1] - A[1]); const n = Math.min(2000, Math.floor(L0 / cell)); for (let q = 1; q <= n; q++) samples.push([A[0] + (B[0] - A[0]) * q / (n + 1), A[1] + (B[1] - A[1]) * q / (n + 1)]); }
        samples.forEach((p, pi) => { const ci = Math.floor(p[0] / cell), cj = Math.floor(p[1] / cell); for (let a = ci - 1; a <= ci + 1; a++) for (let b = cj - 1; b <= cj + 1; b++) (tg.get(a + ',' + b) || []).forEach(ti => { if (seen.has(ti)) return; const t = texts[ti]; let d = Infinity; if (pts.length === 1) d = Math.hypot(t.x - p[0], t.y - p[1]); else { for (let k = 1; k < pts.length; k++) { const A = pts[k - 1], B = pts[k]; const dx = B[0] - A[0], dy = B[1] - A[1]; const L2 = dx * dx + dy * dy; let u = L2 ? ((t.x - A[0]) * dx + (t.y - A[1]) * dy) / L2 : 0; u = Math.max(0, Math.min(1, u)); d = Math.min(d, Math.hypot(t.x - A[0] - u * dx, t.y - A[1] - u * dy)); } } if (d <= cur.textDist) { seen.add(ti); res.push({ t, d }); } }); });
        // also densify long segments for lines
        return res.sort((a, b) => a.d - b.d);
      };
      const out = []; const report = [];
      for (const c of cur.classes) {
        const feats = [];
        for (const l of c.sources) {
          const layerNum = (l.name.match(/(\d{2,4})\s*$/) || [])[1];
          for (const f of l.features) {
            if (!f.wgs || !f.wgs.geometry || f._sym || (f.properties && f.properties.Text != null)) continue;
            let g = f.wgs.geometry; const t = g.type.replace('Multi', '');
            let geo = null;
            if (c.geom === 'point') { if (t === 'Point') geo = g.type === 'Point' ? g : { type: 'Point', coordinates: g.coordinates[0] }; else if (c.circles && t === 'LineString' && isSmallRing(f.geometry)) { const r = g.coordinates; let x = 0, y = 0; r.slice(0, -1).forEach(p => { x += p[0]; y += p[1]; }); geo = { type: 'Point', coordinates: [x / (r.length - 1), y / (r.length - 1)] }; } }
            else if (c.geom === 'line') { if (t === 'LineString' && !(c.circles === undefined && false)) geo = g; }
            else if (c.geom === 'polygon') { if (t === 'Polygon') geo = g; else if (t === 'LineString' && isClosed(f.geometry)) geo = { type: 'Polygon', coordinates: [g.coordinates] }; }
            if (!geo) continue;
            const pg = GV.mapCoords(geo, fwd); // in target CRS
            const props = {}; const src = f.properties || {};
            const txt = (c.text && c.text.length) ? nearTexts(pg) : [];
            c.fields.forEach(fd => {
              const m = c.fmap[fd.name] || { mode: 'auto' };
              let v = null;
              if (m.mode === 'empty') v = null;
              else if (m.mode === 'const') v = m.val;
              else if (m.mode === 'field') v = src[m.val];
              else if (m.mode === 'layer') v = layerNum;
              else {
                const k = Object.keys(src).find(x => x.toLowerCase() === fd.name.toLowerCase()); if (k && src[k] != null && src[k] !== '') v = src[k];
                const nm = fd.name.toUpperCase();
                if (v == null) {
                  if (/^(ACTUALLENGTH|LENGTH|SHAPE_LEN|PIPE_LENGTH)$/.test(nm) && pg.type === 'LineString') { let s = 0; const cc = pg.coordinates; for (let i = 1; i < cc.length; i++) s += Math.hypot(cc[i][0] - cc[i - 1][0], cc[i][1] - cc[i - 1][1]); v = +s.toFixed(3); }
                  else if (/^(X|EASTING|POINT_X|XCOORDINATE|X_COORDINATES?)$/.test(nm) && pg.type === 'Point') v = +pg.coordinates[0].toFixed(3);
                  else if (/^(Y|NORTHING|POINT_Y|YCOORDINATE|Y_COORDINATES?)$/.test(nm) && pg.type === 'Point') v = +pg.coordinates[1].toFixed(3);
                  else if (/^(STARTXCOORDINATE|START_X_COORDINATES_?)$/.test(nm) && pg.type === 'LineString') v = +pg.coordinates[0][0].toFixed(3);
                  else if (/^(STARTYCOORDINATE|START_Y_COORDINATES_?)$/.test(nm) && pg.type === 'LineString') v = +pg.coordinates[0][1].toFixed(3);
                  else if (/^(ENDXCOORDINATE|END_X_COORDINATES_?)$/.test(nm) && pg.type === 'LineString') v = +pg.coordinates[pg.coordinates.length - 1][0].toFixed(3);
                  else if (/^(ENDYCOORDINATE|END_Y_COORDINATES_?)$/.test(nm) && pg.type === 'LineString') v = +pg.coordinates[pg.coordinates.length - 1][1].toFixed(3);
                  else if (/DIAMETER$/.test(nm) && src.DIAMETER != null) v = src.DIAMETER;
                  else if (/^(FEATURETYPE|VALVETYPE|TYPE)$/.test(nm) && (src.VALVE_TYPE || src.LEGEND || src.ELEMENT)) v = src.VALVE_TYPE || src.LEGEND || src.ELEMENT;
                  else if (/^(REMARKS)$/.test(nm) && src.LEGEND) v = src.LEGEND;
                  else if (/^(GROUNDELEVATION|COVER_LEVEL)$/.test(nm) && src.Elevation != null) v = src.Elevation;
                  else if (/^(Z|ELEVATION)$/.test(nm)) { const c0 = GV.firstCoord(f.geometry); if (c0 && c0.length > 2 && c0[2]) v = c0[2]; }
                }
                if (v == null && c.text) { const rule = c.text.find(r => r.field.toLowerCase() === fd.name.toLowerCase()); if (rule) for (const { t } of txt) { const mm = t.t.match(rule.re); if (mm) { let val = mm.slice(1).find(x => x != null) || mm[0]; val = String(val).trim(); if (rule.up) val = val.toUpperCase(); if (rule.num) { const n = parseFloat(val); if (!isFinite(n)) continue; val = n; } v = val; break; } } }
                if (v == null && layerNum && /^(DIAMETER|DIA|SIZE|METERSIZE)$/i.test(fd.name)) v = +layerNum;
                if (v == null && /^(VALVETYPE|FITTINGTYPE|JUNCTIONTYPE|TYPE|INLETTYPE|MH_TYPE|Pole_Type)$/i.test(fd.name) && src.Block) v = src.Block;
              }
              if (v != null && v !== '') { if (fd.type === 'int') { const n = parseInt(v, 10); v = isFinite(n) ? n : null; } else if (fd.type === 'real') { const n = parseFloat(v); v = isFinite(n) ? n : null; } else v = String(v); }
              props[fd.name] = v === '' ? null : v;
            });
            props.SOURCE_LAYER = l.name;
            feats.push({ type: 'Feature', properties: props, geometry: pg });
          }
        }
        const types = {}; c.fields.forEach(fd => types[fd.name] = fd.type); types.SOURCE_LAYER = 'text';
        out.push({ name: c.name, features: feats, crs: cur.crs, color: cur.tpl.color, types, fields: c.fields.map(f => f.name).concat(['SOURCE_LAYER']) });
        const fill = c.fields.map(fd => ({ f: fd.name, p: feats.length ? Math.round(feats.filter(x => x.properties[fd.name] != null).length / feats.length * 100) : 0 }));
        report.push({ name: c.name, n: feats.length, fill });
      }
      // build the network: surveyed nodes, nodes on lines, lines snapped & split at nodes (our delivered-data conventions)
      let build = null; try { if (GV.netBuild) { $('#busyText').textContent = 'ببني الشبكة: نقط الرفع، توصيل الخطوط بالأجهزة…'; await new Promise(r => setTimeout(r, 20)); const netId = /^(water|storm|sewer|lighting|power|telecom|gas|irrigation)$/.test(cur.tpl.id || '') ? cur.tpl.id : (GV.store.get('gv_orgnet') || 'water'); build = GV.netBuild(out, netId, GV.netSurveyPoints(fwd)); out.forEach((o, i) => { const r = report.find(x => x.name === o.name); if (r) { r.n = o.features.length; } }); } } catch (e) { console.error('netBuild', e); }
      GV.wsLastBuild = build;
      const old = GV.sources.find(s => s.wsOut === cur.tpl.name); if (old) GV.removeSource(old);
      const added = await GV.addGroups([{ name: 'مخرجات: ' + cur.tpl.name, type: 'بيئة عمل', layers: out.map(o => ({ name: o.name, features: o.features, crs: o.crs, color: o.color })) }], {
        before: ad => { const s = ad[0]; s.wsOut = cur.tpl.name; s.layers.forEach((l, i) => { l.schemaTypes = out[i].types; l.schemaFields = out[i].fields; if (!l.features.length) l.kind = ({ point: 'point', line: 'line', polygon: 'polygon' })[cur.classes[i].geom]; }); }
      });
      $('#busy').classList.remove('show');
      showReport(report, added && added[0]);
      return { src: added && added[0], report, build };
    } catch (e) { GV.showMsg('حصلت مشكلة في التحويل: ' + (e.message || e)); console.error(e); }
    finally { $('#busy').classList.remove('show'); }
  }
  function showReport(rep, src) {
    const box = $('#wsBody'); box.textContent = '';
    const back = el('button', 'chip', '→ رجوع للربط'); back.onclick = renderMap; box.appendChild(back);
    box.appendChild(el('h3', null, 'اتحولت الداتا ✓'));
    rep.forEach(r => {
      const c = el('div', 'fcard'); c.appendChild(el('b', null, r.name + ' · ' + r.n.toLocaleString('en') + ' عنصر'));
      if (r.n) { const fl = el('div', 'fill-list'); r.fill.forEach(x => { const s = el('span', 'fill ' + (x.p === 100 ? 'ok' : x.p === 0 ? 'no' : 'mid'), x.f + ' ' + x.p + '%'); fl.appendChild(s); }); c.appendChild(fl); }
      else c.appendChild(el('small', 'muted', 'مفيش عناصر اتربطت بالكلاس ده'));
      box.appendChild(c);
    });
    box.appendChild(el('p', 'muted small', 'النسبة = كام في المية من العناصر الحقل ده اتملا فيها. الأحمر فاضي خالص ومحتاج قيمة ثابتة أو شغل يدوي.'));
    const acts = el('div', 'fc-acts');
    const qc = el('button', 'open-btn sm', 'افحص الشبكة (QC + Utility Network)'); qc.onclick = () => { if (!src) return; GV.openQC(src.layers); setTimeout(() => {  }, 50); };
    const ex = el('button', 'chip', 'صدّر GDB بالسكيما'); ex.onclick = () => { if (!src) return; GV.openExport(src.layers); setTimeout(() => { document.querySelectorAll('#expFmts input').forEach(c => c.checked = c.value === 'gdb'); $('#expCrs').value = 'orig'; document.querySelector('#expFmts input').dispatchEvent(new Event('change')); }, 50); };
    const tb = el('button', 'chip', 'الجداول'); tb.onclick = () => { GV.openSheet('#layerSheet'); };
    acts.append(qc, ex, tb); box.appendChild(acts);
  }

  $('#btnWS').addEventListener('click', open);
  GV.wsAuto = async (id, schemaSrc) => { const t = schemaSrc ? tplFromSource(schemaSrc) : TPL.find(x => x.id === id); if (!t) return null; start._auto = true; try { start(t); } finally { start._auto = false; } if (!cur) return null; return runConvert(); };
  GV.wsStart = id => { const t = TPL.find(x => x.id === id); if (!t) return open(); start(t); GV.openSheet('#wsSheet'); };
  GV.wsSchemas = () => schemaSources().map(s => ({ name: s.name, go: () => { start(tplFromSource(s)); GV.openSheet('#wsSheet'); } }));
  GV.openWorkspaces = open; GV.TEMPLATES = TPL;
})();
