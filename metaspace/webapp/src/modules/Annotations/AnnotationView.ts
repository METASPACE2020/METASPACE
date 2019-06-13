 import { renderMolFormula } from '../../util';
 import DatasetInfo from '../../components/DatasetInfo.vue';
 import ColocalizationSettings from './annotation-widgets/ColocalizationSettings.vue';
 import { annotationQuery } from '../../api/annotation';
 import {
  datasetVisibilityQuery,
  DatasetVisibilityResult,
  msAcqGeometryQuery,
  OpticalImage,
  opticalImagesQuery,
} from '../../api/dataset';
 import { encodeParams } from '../Filters/index';
 import annotationWidgets from './annotation-widgets/index'

 import Vue from 'vue';
 import { Component, Prop } from 'vue-property-decorator';
 import { Location } from 'vue-router';
 import { currentUserRoleQuery, CurrentUserRoleResult} from '../../api/user';
 import safeJsonParse from '../../lib/safeJsonParse';
 import {omit, pick, sortBy, throttle} from 'lodash-es';
 import {ANNOTATION_SPECIFIC_FILTERS} from '../Filters/filterSpecs';
 import config from '../../config';
 import noImageURL from '../../assets/no-image.svg';
 import {OpacityMode} from '../../lib/createColormap';

 type colorObjType = {
   code: string,
   colorName: string
 }

 type ImagePosition = {
   zoom: number
   xOffset: number
   yOffset: number
 }

 type ImageSettings = {
   annotImageOpacity: number
   opacityMode: OpacityMode
   imagePosition: ImagePosition
   opticalSrc: string | null
   opticalTransform: number[][] | null
   pixelAspectRatio: number
   // hotspotQuantile is deliberately not included here, because every time it changes some slow computation occurs,
   // and the computed getters were being triggered by any part of the ImageSettings object changing, such as opacity,
   // causing a lot of jank.
   //hotspotQuantile?: number
 }

 const metadataDependentComponents: any = {};
 const componentsToRegister: any = { DatasetInfo, ColocalizationSettings };
 for (let category of Object.keys(annotationWidgets)) {
   metadataDependentComponents[category] = {};
   for (let mdType of Object.keys(annotationWidgets[category])) {
     const component = annotationWidgets[category][mdType];
     metadataDependentComponents[category][mdType] = component;
     componentsToRegister[`${category}-${mdType}`] = component;
   }
 }

 @Component<AnnotationView>({
   name: 'annotation-view',
   components: componentsToRegister,
   apollo: {
     peakChartData: {
       query: annotationQuery,
       update: (data: any) => {
         const {annotation} = data;
         if (annotation != null) {
           let chart = safeJsonParse(annotation.peakChartData);
           chart.sampleData = {
             mzs: annotation.isotopeImages.map((im: any) => im.mz),
             ints: annotation.isotopeImages.map((im: any) => im.totalIntensity),
           };
           return chart;
         } else {
           return null;
         }
       },
       variables(): any {
         return {
           id: this.annotation.id
         };
       }
     },

     opticalImages: {
       query: opticalImagesQuery,
       variables() {
         return {
           datasetId: this.annotation.dataset.id,
           type: config.features.optical_transform ? 'SCALED' : 'CLIPPED_TO_ION_IMAGE',
         }
       },
       update(data: any) {
         return data.dataset && data.dataset.opticalImages || [];
       }
     },

     msAcqGeometry: {
       query: msAcqGeometryQuery,
       variables(): any {
         return {
          datasetId: this.annotation.dataset.id
         }
       },
       update: (data: any) => data['dataset'] && safeJsonParse(data['dataset']['acquisitionGeometry'])
     },

     datasetVisibility: {
       query: datasetVisibilityQuery,
       skip: true,
       variables() {
         return {id: this.annotation.dataset.id}
       }
     },

     currentUser: {
       query: currentUserRoleQuery,
       fetchPolicy: 'cache-first',
     }
   }
 })
 export default class AnnotationView extends Vue {
   @Prop()
   annotation: any

   msAcqGeometry: any
   peakChartData: any
   opticalImages!: OpticalImage[] | null
   showScaleBar: boolean = false
   datasetVisibility: DatasetVisibilityResult | null = null
   currentUser: CurrentUserRoleResult | null = null
   scaleBarColor: string = '#000000'
   failedImages: string[] = []
   noImageURL = noImageURL

   created() {
     this.onImageMove = throttle(this.onImageMove);
   }

   metadataDependentComponent(category: string): any {
     const currentMdType: string = this.$store.getters.filter.metadataType;
     const componentKey: string = currentMdType in metadataDependentComponents[category] ? currentMdType : 'default';
     return metadataDependentComponents[category][componentKey];
   }

   get showOpticalImage(): boolean {
     return !this.$route.query.hideopt;
   }

   get activeSections(): string[] {
     return this.$store.getters.settings.annotationView.activeSections;
   }

   get colormap(): string {
     return this.$store.getters.settings.annotationView.colormap;
   }

   get hotspotQuantile(): number | undefined {
     const threshold = this.$store.getters.settings.annotationView.hotspotThreshold;
     return threshold ? threshold / 100 : undefined;
   }

   get colormapName(): string {
     return this.colormap.replace('-', '');
   }

   get formattedMolFormula(): string {
     if (!this.annotation) return '';
     const { sumFormula, adduct, dataset } = this.annotation;
     return renderMolFormula(sumFormula, adduct, dataset.polarity);
   }

   get compoundsTabLabel(): string {
     if (!this.annotation) return '';
     return "Molecules (" + this.annotation.possibleCompounds.length + ")";
   }

   get imageOpacityMode(): OpacityMode {
     return (this.showOpticalImage && this.bestOpticalImage != null) ? 'linear' : 'constant';
   }

   get permalinkHref(): Location {
     const filter: any = {
       datasetIds: [this.annotation.dataset.id],
       compoundName: this.annotation.sumFormula,
       adduct: this.annotation.adduct,
       fdrLevel: this.annotation.fdrLevel,
       database: this.$store.getters.filter.database,
       simpleQuery: '',
     };
     const path = '/annotations';
     return {
       path,
       query: {
         ...encodeParams(filter, path, this.$store.state.filterLists),
         ...pick(this.$route.query, 'sections', 'sort', 'hideopt', 'cmap', 'hotspotthreshold'),
       },
     };
   }

   get bestOpticalImage(): OpticalImage | null {
     if (this.opticalImages != null && this.opticalImages.length > 0) {
       const {zoom} = this.imagePosition;
       // Find the best optical image, preferring images with a higher zoom level than the current zoom
       const sortedOpticalImages = sortBy(this.opticalImages, optImg =>
         optImg.zoom >= zoom
           ? optImg.zoom - zoom
           : 100 + (zoom - optImg.zoom));

       return sortedOpticalImages[0];
     }
     return null;
   }

   get imageLoaderSettings(): ImageSettings {
     const optImg = this.bestOpticalImage;
     const hasOpticalImages = this.showOpticalImage && optImg != null;

     return {
       annotImageOpacity: (this.showOpticalImage && hasOpticalImages) ? this.opacity : 1.0,
       opacityMode: this.imageOpacityMode,
       imagePosition: this.imagePosition,
       opticalSrc: this.showOpticalImage && optImg && optImg.url || null,
       opticalTransform: optImg && optImg.transform,
       pixelAspectRatio: config.features.ignore_pixel_aspect_ratio ? 1
         : this.pixelSizeX && this.pixelSizeY && this.pixelSizeX / this.pixelSizeY || 1,
     };
   }

   get visibilityText() {
     if (this.datasetVisibility != null && this.datasetVisibility.id === this.annotation.dataset.id) {
       const {submitter, group, projects} = this.datasetVisibility;
       const submitterName = this.currentUser && submitter.id === this.currentUser.id ? 'you' : submitter.name;
       const all = [
         submitterName,
         ...(group ? [group.name] : []),
         ...(projects || []).map(p => p.name),
       ];
       return `These annotation results are not publicly visible. They are visible to ${all.join(', ')} and METASPACE Administrators.`
     }
   }

   get metadata() {
     const datasetMetadataExternals = {
       "Submitter": this.annotation.dataset.submitter,
       "PI": this.annotation.dataset.principalInvestigator,
       "Group": this.annotation.dataset.group,
       "Projects": this.annotation.dataset.projects
     };
     return Object.assign(safeJsonParse(this.annotation.dataset.metadataJson), datasetMetadataExternals);
   }

   get pixelSizeX() {
     if (this.metadata.MS_Analysis != null &&
       this.metadata.MS_Analysis.Pixel_Size != null) {
       return this.metadata.MS_Analysis.Pixel_Size.Xaxis
     }
     return 0
   }

   get pixelSizeY() {
     if (this.metadata.MS_Analysis != null &&
       this.metadata.MS_Analysis.Pixel_Size != null) {
       return this.metadata.MS_Analysis.Pixel_Size.Yaxis
     }
     return 0
   }

   get showColoc() {
     return config.features.coloc;
   }

   opacity: number = 1.0;

   imagePosition: ImagePosition = {
     zoom: 1,
     xOffset: 0,
     yOffset: 0
   };

   onSectionsChange(activeSections: string[]): void {
     // FIXME: this is a hack to make isotope images redraw
     // so that they pick up the changes in parent div widths
     this.$nextTick(() => {
       window.dispatchEvent(new Event('resize'));
     });

     this.$store.commit('updateAnnotationViewSections', activeSections)
   }

   onImageMove(event: any): void {
     this.imagePosition.zoom = event.zoom;
     this.imagePosition.xOffset = event.xOffset;
     this.imagePosition.yOffset = event.yOffset;
   }

   onCompoundImageError(url: string) {
     this.failedImages.push(url);
   }

   resetViewport(event: any): void {
     event.stopPropagation();
     this.imagePosition.xOffset = 0;
     this.imagePosition.yOffset = 0;
     this.imagePosition.zoom = 1;
   }

   toggleOpticalImage(event: any): void {
     event.stopPropagation();
     if(this.showOpticalImage) {
       this.$router.replace({
         query: {
           ...this.$route.query,
           hideopt: '1',
         }
       });
     } else {
       this.$router.replace({
         query: omit(this.$route.query, 'hideopt'),
       });
     }
   }

   toggleScaleBar(): void {
     this.showScaleBar = !this.showScaleBar
   }

   loadVisibility() {
     this.$apollo.queries.datasetVisibility.start();
   }

   setScaleBarColor(colorObj: colorObjType) {
     this.scaleBarColor = colorObj.code;
   }

   filterColocSamples() {
     this.$store.commit('updateFilter', {
       ...omit(this.$store.getters.filter, ANNOTATION_SPECIFIC_FILTERS),
       datasetIds: [this.annotation.dataset.id],
       colocalizationSamples: true,
     })
   }

   filterColocalized() {
     this.$store.commit('updateFilter', {
       ...omit(this.$store.getters.filter, ANNOTATION_SPECIFIC_FILTERS),
       datasetIds: [this.annotation.dataset.id],
       colocalizedWith: this.annotation.ion,
     });
     this.$store.commit('setSortOrder', {
       by: 'colocalization',
       dir: 'descending'
     });
   }

 }
